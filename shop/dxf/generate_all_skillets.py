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

STEM_MIN, STEM_MAX = 0.625, 3.000
STEM_OF_OD = 0.30          # preferred stem as a fraction of disc OD

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


def stem_at_clear(bc, n, bd, clear):
    return 2.0 * (bolt_offset(bc, n) - bd / 2.0 - clear)


def pick_stem(od, bc, n, bd):
    """
    Stem sized to the part, then capped by the bolts. Aim to leave
    PREF_BOLT_CLEAR to the shanks; only crowd toward MIN_BOLT_CLEAR when the
    preferred gap would make the stem too thin to be a usable handle.
    """
    want = min(max(STEM_OF_OD * od, STEM_MIN), STEM_MAX)
    roomy = floor_to(min(want, stem_at_clear(bc, n, bd, PREF_BOLT_CLEAR)), 0.125)
    if roomy >= STEM_MIN:
        return roomy
    return floor_to(min(want, stem_at_clear(bc, n, bd, MIN_BOLT_CLEAR)), 0.125)


def handle(stem):
    bar_l = round_to(min(max(2.75 * stem, 2.5), 10.0), 0.25)
    bar_d = round_to(min(max(0.75 * stem, 0.75), 2.0), 0.125)
    fil = round_to(min(max(0.20 * stem, 0.125), 0.375), 0.0625)
    return bar_l, bar_d, fil


def main():
    base = sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(
        os.path.abspath(__file__))
    made, flagged = 0, []

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

        stem = pick_stem(OD, BC, n, bd)
        gap = bolt_offset(BC, n) - bd / 2.0 - stem / 2.0
        if stem < STEM_MIN:
            flagged.append((cls, nps, stem, max_stem(BC, n, bd)))
            continue
        bar_l, bar_d, fil = handle(stem)

        ents = t_blind(disc_od=OD, stem_w=stem, bar_len=bar_l, bar_d=bar_d,
                       overall=fod / 2.0 + FLANGE_GAP + bar_d,
                       bore=None, root_r=fil, inner_r=fil, corner_r=0.25,
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
