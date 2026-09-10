#!/usr/bin/env python3
"""
Skillet blind (T-handle line blank) DXF generator
State of the Arc Welding and Services LLC

Disc OD follows the shop rule, confirmed against Gilbert's numbers:

    disc OD = bolt circle diameter - bolt diameter        (ASME B16.5 Class 150)

The blank seats against the inside of the bolt shanks, so the bolts capture and
centre it. Note this is bolt DIAMETER, not bolt HOLE diameter -- the blank rests
on the bolts themselves.

Handle reach follows the shop rule:

    the crossbar STARTS 2" past the edge of the flange

so the whole T sits clear of the flange with 2" of bare stem behind it, and
there is room to get a hand on it with the joint bolted up.

Stem width is checked against the bolts. The stem is installed centred between
two adjacent bolts, and every size is verified to keep at least MIN_BOLT_CLEAR
between the stem edge and the bolt shank.

    python3 generate_skillet_blinds.py [output_dir]

Units are INCHES. Geometry is nominal -- apply kerf compensation in CAM.
"""

import math
import os
import sys

from t_handle import t_blind
from generate_paddle_blinds import dxf, svg, bbox

CLASS = 150

# Stem edge to bolt shank, per side. The stem must slip between two bolts.
MIN_BOLT_CLEAR = 0.375

# Bare stem between the flange edge and the start of the crossbar.
FLANGE_GAP = 2.00

# ---------------------------------------------------------------------------
# ASME B16.5 Class 150 flange data.
#   bolt_d     drives the disc OD (bolt circle - bolt diameter)
#   flange_od  drives handle reach; half of it is Gilbert's "centre to edge"
# ---------------------------------------------------------------------------
FLANGE = {
    # nps:  (bolt circle, n bolts, bolt dia, flange OD, Sch 40 ID)
    "2":    (4.75,  4, 0.625,  6.00,  2.067),
    "3":    (6.00,  4, 0.625,  7.50,  3.068),
    "4":    (7.50,  8, 0.625,  9.00,  4.026),
    "6":    (9.50,  8, 0.750, 11.00,  6.065),
    "8":   (11.75,  8, 0.750, 13.50,  7.981),
    "10":  (14.25, 12, 0.875, 16.00, 10.020),
}

# ---------------------------------------------------------------------------
# T-handle dimensions.
#   stem   stem width -- capped by bolt clearance, see check_stem()
#   bar_l  crossbar length, tip to tip
#   bar_d  crossbar depth, along the stem axis
#   hole   tag hole in the stem
# Reach is not listed: the crossbar always starts FLANGE_GAP past the flange.
# ---------------------------------------------------------------------------
HANDLE = {
    "2":  dict(stem=1.250, bar_l=4.00, bar_d=1.00, hole=0.500),
    "3":  dict(stem=1.500, bar_l=4.50, bar_d=1.25, hole=0.500),
    "4":  dict(stem=1.375, bar_l=4.50, bar_d=1.25, hole=0.500),
    "6":  dict(stem=2.000, bar_l=6.00, bar_d=1.50, hole=0.625),
    "8":  dict(stem=2.000, bar_l=6.00, bar_d=1.50, hole=0.625),
    "10": dict(stem=2.000, bar_l=7.00, bar_d=1.75, hole=0.750),
}

LABEL = {"2": '2"', "3": '3"', "4": '4"', "6": '6"', "8": '8"', "10": '10"'}

# Per-size OD overrides, if a size ever needs to depart from the rule.
OVERRIDE = {}


def disc_od(nps):
    bc, _, bolt_d, _, _ = FLANGE[nps]
    return bc - bolt_d


def bolt_clearance(nps, stem_w):
    """
    Gap between the stem edge and the nearest bolt shank, per side, with the
    stem installed centred between two adjacent bolts.

    The nearest bolt centre sits half a bolt pitch off the stem axis, so its
    perpendicular offset from the stem centreline is (BC/2) * sin(pi/n).
    """
    bc, n, bolt_d, _, _ = FLANGE[nps]
    offset = (bc / 2.0) * math.sin(math.pi / n)
    return offset - bolt_d / 2.0 - stem_w / 2.0


def max_stem(nps):
    """Widest stem that still keeps MIN_BOLT_CLEAR to the bolts."""
    return 2.0 * (bolt_clearance(nps, 0.0) - MIN_BOLT_CLEAR)


def check_stem(nps, stem_w):
    c = bolt_clearance(nps, stem_w)
    if c < MIN_BOLT_CLEAR:
        raise ValueError(
            'NPS %s stem %.3f" leaves only %.3f" to the bolts (min %.3f"). '
            'Widest stem for this size is %.3f".'
            % (nps, stem_w, c, MIN_BOLT_CLEAR, max_stem(nps)))
    return c


def build(nps, od, bored):
    bc, n, bolt_d, flange_od, sch40 = FLANGE[nps]
    h = HANDLE[nps]
    check_stem(nps, h["stem"])
    fil = 0.375 if h["stem"] >= 2.0 else 0.25
    kind = "SPACER" if bored else "SKILLET"
    # Crossbar starts FLANGE_GAP past the flange edge; overall is its outer face.
    overall = flange_od / 2.0 + FLANGE_GAP + h["bar_d"]
    return t_blind(
        disc_od=od,
        stem_w=h["stem"],
        bar_len=h["bar_l"],
        bar_d=h["bar_d"],
        overall=overall,
        bore=sch40 if bored else None,
        root_r=fil,
        inner_r=fil,
        corner_r=0.25,
        hole=h["hole"],
        label="%s CL%d %s" % (LABEL[nps], CLASS, kind),
    )


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "skillet-blinds-cl%d" % CLASS)
    os.makedirs(out, exist_ok=True)

    print("%-26s %8s %8s %8s %8s %9s %9s" % (
        "file", "disc OD", "flange r", "bar at", "total L", "stem", "bolt gap"))
    for nps in FLANGE:
        od = OVERRIDE.get(nps, disc_od(nps))
        h = HANDLE[nps]
        bc, n, bolt_d, flange_od, sch40 = FLANGE[nps]
        ents = build(nps, od, bored=False)
        name = "NPS%s_CL%d_skillet" % (nps, CLASS)
        with open(os.path.join(out, name + ".dxf"), "w") as f:
            f.write(dxf(ents))
        with open(os.path.join(out, name + ".svg"), "w") as f:
            f.write(svg(ents))
        x0, y0, x1, y1 = bbox(ents)
        print("%-26s %8.3f %8.3f %8.3f %8.3f %9.3f %9.3f" % (
            name + ".dxf", od, flange_od / 2.0,
            flange_od / 2.0 + FLANGE_GAP, x1 - x0,
            h["stem"], bolt_clearance(nps, h["stem"])))

    print("\nCrossbar starts %.2f\" past the flange edge on every size." % FLANGE_GAP)
    print("Bolt gap is stem edge to bolt shank, per side (min %.3f\")."
          % MIN_BOLT_CLEAR)


if __name__ == "__main__":
    main()
