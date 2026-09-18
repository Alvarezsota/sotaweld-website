#!/usr/bin/env python3
"""
Skillet blind (T-handle line blank) DXF generator -- Classes 150/300/600/900
State of the Arc Welding and Services LLC

Data comes from blank_data.py:
  * disc OD, bolt circle, bore and plate thickness are the MANUFACTURER table
  * flange OD and bolt count are ASME B16.5
  * bolt diameter is DERIVED as (bolt circle - disc OD) - 1/8 and cross-checked
    against B16.5, so wrong bolt data fails the build rather than reaching plate

Two shop rules:
  disc OD  = bolt circle - bolt HOLE diameter   (1/16" radial to the shanks)
  reach    = the crossbar STARTS 2" past the flange edge

The stem is installed centred between two adjacent bolts and no bolt passes
through it. Stem width is sized to the bolt gap, never the other way round.

    python3 generate_all_skillets.py [output_dir]

Units are INCHES. Geometry is nominal -- apply kerf compensation in CAM.
"""

import math
import os
import sys

from t_handle import t_blind
from generate_paddle_blinds import dxf, svg, bbox
from blank_data import rows, B16_5, HOLE_OVER_BOLT

MIN_BOLT_CLEAR = 0.125     # stem edge to bolt shank, per side -- hard floor
PREF_BOLT_CLEAR = 0.1875   # aim for this much; fall back toward the floor
FLANGE_GAP = 2.00          # bare stem past the flange edge before the crossbar

# ONE handle for every size and class. The stem is capped by the tightest
# flange in the whole library -- the 1/2" Class 150, four 1/2" bolts on a
# 2-3/8" bolt circle, which allows 0.929". 7/8" is the widest 1/8" step that
# fits there, and it clears every other size with room to spare.
STEM = 0.875

# The knob (crossbar) steps up at 12" NPS and above, where the blanks get heavy
# enough to want a better grip. The stem stays 7/8" everywhere -- only the knob
# changes, so the bolt clearance is untouched by this.
BIG_KNOB_FROM = 12.0
BAR_L, BAR_D = 3.000, 1.000          # under 12"
BAR_L_BIG, BAR_D_BIG = 4.000, 1.250  # 12" and up
ROOT_R = 0.1875
CORNER_R = 0.25


def nps_value(nps):
    """'1-1/4' -> 1.25, '3/4' -> 0.75, '12' -> 12.0."""
    whole, _, frac_part = nps.partition("-")
    if "/" in whole:
        n, d = whole.split("/")
        return float(n) / float(d)
    v = float(whole)
    if frac_part:
        n, d = frac_part.split("/")
        v += float(n) / float(d)
    return v


def knob(nps):
    """Crossbar length and depth for this size."""
    return (BAR_L_BIG, BAR_D_BIG) if nps_value(nps) >= BIG_KNOB_FROM \
        else (BAR_L, BAR_D)

# The manufacturer table is published to 2 decimals, so 8-5/8" arrives as 8.62.
# Snap back to the real fraction when the gap is plainly a rounding artifact.
SNAP, SNAP_TOL = 1.0 / 32.0, 0.008

# Filename-safe NPS tokens. "1-1/2" would read as a range in a file listing.
TOKEN = {"1/2": "0.5", "3/4": "0.75", "1-1/4": "1.25", "1-1/2": "1.5",
         "2-1/2": "2.5", "3-1/2": "3.5"}


def snap(x):
    """Undo the table's 2-decimal rounding, where that is unambiguous."""
    s = round(x / SNAP) * SNAP
    return s if abs(s - x) <= SNAP_TOL else x


def frac(x, den=32):
    """Format as inches and a reduced fraction, e.g. 8.625 -> 8-5/8."""
    whole = int(x + 1e-9)
    rem = x - whole
    num = int(round(rem * den))
    if num == 0:
        return str(whole)
    d = den
    while num % 2 == 0 and d % 2 == 0:
        num //= 2
        d //= 2
    if abs(whole + num / d - x) > 1e-4:
        return "%.3f" % x
    return ("%d-%d/%d" % (whole, num, d)) if whole else ("%d/%d" % (num, d))


def floor_to(x, step):
    return math.floor(x / step + 1e-9) * step


def round_to(x, step):
    return round(x / step) * step


def bolt_dia(bc, od):
    return round(bc - od - HOLE_OVER_BOLT, 4)


def bolt_offset(bc, n):
    """Perpendicular distance from the stem centreline to the nearest bolt centre."""
    return (bc / 2.0) * math.sin(math.pi / n)


def max_stem(bc, n, bd):
    return 2.0 * (bolt_offset(bc, n) - bd / 2.0 - MIN_BOLT_CLEAR)


def pick_stem(od, bc, n, bd):
    """One stem for the whole library. Kept as a function so callers are unchanged."""
    return STEM


def handle(nps):
    bl, bd = knob(nps)
    return bl, bd, ROOT_R


def main():
    base = sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(
        os.path.abspath(__file__))
    made, flagged = 0, []
    tight = min((2.0 * (bolt_offset(snap(BC), B16_5[(c, n)][1])
                        - B16_5[(c, n)][2] / 2.0 - MIN_BOLT_CLEAR), c, n)
                for c, n, I, O, BC, t, w in rows())
    if STEM > tight[0] + 1e-9:
        raise ValueError("uniform stem %.3f exceeds CL%d %s limit of %.3f"
                         % (STEM, tight[1], tight[2], tight[0]))
    print("uniform stem %s\" -- tightest flange is CL%d %s at %.3f\" max" % (
        frac(STEM), tight[1], tight[2], tight[0]))
    print("knob %s x %s under %s\", %s x %s at %s\" and up\n" % (
        frac(BAR_L), frac(BAR_D), frac(BIG_KNOB_FROM),
        frac(BAR_L_BIG), frac(BAR_D_BIG), frac(BIG_KNOB_FROM)))

    print("%-28s %8s %7s %6s %7s %6s %8s %8s" % (
        "file", "disc OD", "plate", "bolts", "stem", "gap", "bar at", "total L"))
    for cls, nps, ID, OD, BC, thk, web in rows():
        key = (cls, nps)
        fod, n, expect = B16_5[key]
        # Verify with the table-derived bolt size, then compute with the exact
        # one -- the table's 2-decimal rounding is worth up to 0.005" otherwise.
        if abs(bolt_dia(BC, OD) - expect) > 0.02:
            raise ValueError("CL%d %s: derived bolt %.3f vs B16.5 %.3f"
                             % (cls, nps, bolt_dia(BC, OD), expect))
        bd = expect
        OD, BC, thk = snap(OD), snap(BC), snap(thk)
        if 2.0 * (BC / 2.0) * math.sin(math.pi / n) <= bd:
            raise ValueError("CL%d %s: %d bolts of %.3f do not fit on a %.3f BC"
                             % (cls, nps, n, bd, BC))
        if OD / 2.0 > BC / 2.0 - bd / 2.0 + 1e-9:
            raise ValueError("CL%d %s: disc OD %.3f overlaps the bolt shanks"
                             % (cls, nps, OD))

        # The uniform stem is proved against the tightest flange above, so a
        # per-part fallback is unreachable; this is belt and braces.
        stem, fil = STEM, ROOT_R
        bar_l, bar_d = knob(nps)
        gap = bolt_offset(BC, n) - bd / 2.0 - stem / 2.0
        if gap < MIN_BOLT_CLEAR:
            flagged.append((cls, nps, stem, max_stem(BC, n, bd)))
            continue

        ents = t_blind(disc_od=OD, stem_w=stem, bar_len=bar_l, bar_d=bar_d,
                       overall=fod / 2.0 + FLANGE_GAP + bar_d,
                       bore=None, root_r=fil, inner_r=fil, corner_r=CORNER_R,
                       hole=None, label='%s CL%d SKILLET' % (nps, cls))

        out = os.path.join(base, "skillet-blinds-cl%d" % cls)
        os.makedirs(out, exist_ok=True)
        name = "NPS%s_CL%d_skillet" % (TOKEN.get(nps, nps), cls)
        with open(os.path.join(out, name + ".dxf"), "w") as f:
            f.write(dxf(ents))
        with open(os.path.join(out, name + ".svg"), "w") as f:
            f.write(svg(ents))
        made += 1
        x0, y0, x1, y1 = bbox(ents)
        print("%-28s %8s %7s %6s %7s %6.3f %8.3f %8.3f" % (
            name + ".dxf", frac(OD), frac(thk) + '"', "%dx%s" % (n, frac(bd)),
            frac(stem), gap, fod / 2.0 + FLANGE_GAP, x1 - x0))

    print("\n%d parts written." % made)
    if flagged:
        print("\nNOT BUILT -- bolts too crowded for a usable stem:")
        for cls, nps, s, m in flagged:
            print("  CL%-4d %-7s widest stem that clears the bolts: %.3f\"" % (cls, nps, m))


if __name__ == "__main__":
    main()
