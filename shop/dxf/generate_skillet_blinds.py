#!/usr/bin/env python3
"""
Skillet blind (T-handle line blank) DXF generator
State of the Arc Welding and Services LLC

Disc OD follows the shop rule, confirmed against Gilbert's numbers:

    disc OD = bolt circle diameter - bolt diameter        (ASME B16.5 Class 150)

The blank seats against the inside of the bolt shanks, so the bolts capture and
centre it. Note this is bolt DIAMETER, not bolt HOLE diameter -- the blank rests
on the bolts themselves.

    python3 generate_skillet_blinds.py [output_dir]

Units are INCHES. Geometry is nominal -- apply kerf compensation in CAM.
"""

import os
import sys

from t_handle import t_blind
from generate_paddle_blinds import dxf, svg, bbox

CLASS = 150

# ---------------------------------------------------------------------------
# ASME B16.5 Class 150 flange data. bolt_d drives the disc OD, flange_od drives
# how far the handle has to reach to stay visible with the joint bolted up.
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
# T-handle dimensions. THESE ARE DEFAULTS, pending Gilbert's actual numbers.
#   stem   stem width
#   bar_l  crossbar length, tip to tip
#   bar_d  crossbar depth, along the stem axis
#   proj   how far the outer face of the crossbar sits past the flange OD
#   hole   tag hole in the stem
# ---------------------------------------------------------------------------
HANDLE = {
    "2":   dict(stem=1.25, bar_l=3.75, bar_d=1.00, proj=1.50, hole=0.500),
    "3":   dict(stem=1.50, bar_l=4.50, bar_d=1.25, proj=1.50, hole=0.500),
    "4":   dict(stem=1.50, bar_l=4.50, bar_d=1.25, proj=1.50, hole=0.500),
    "6":   dict(stem=2.00, bar_l=6.00, bar_d=1.50, proj=1.75, hole=0.625),
    "8":   dict(stem=2.00, bar_l=6.00, bar_d=1.50, proj=1.75, hole=0.625),
    "10":  dict(stem=2.50, bar_l=7.50, bar_d=1.75, proj=2.00, hole=0.750),
}

LABEL = {"2": '2"', "3": '3"', "4": '4"', "6": '6"', "8": '8"', "10": '10"'}

# Per-size OD overrides, if a size ever needs to depart from the rule.
OVERRIDE = {}


def disc_od(nps):
    bc, _, bolt_d, _, _ = FLANGE[nps]
    return bc - bolt_d


def build(nps, od, bored):
    bc, n, bolt_d, flange_od, sch40 = FLANGE[nps]
    h = HANDLE[nps]
    fil = 0.375 if h["stem"] >= 2.0 else 0.25
    kind = "SPACER" if bored else "SKILLET"
    return t_blind(
        disc_od=od,
        stem_w=h["stem"],
        bar_len=h["bar_l"],
        bar_d=h["bar_d"],
        overall=flange_od / 2.0 + h["proj"],
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

    jobs = []
    for nps in FLANGE:
        for od, tag in OVERRIDE.get(nps, [(disc_od(nps), None)]):
            name = "NPS%s_CL%d_skillet" % (nps, CLASS)
            if tag:
                name += "_" + tag
            jobs.append((nps, od, name))

    print("%-34s %8s %10s %14s" % ("file", "disc OD", "overall", "bolt clearance"))
    for nps, od, name in jobs:
        ents = build(nps, od, bored=False)
        with open(os.path.join(out, name + ".dxf"), "w") as f:
            f.write(dxf(ents))
        with open(os.path.join(out, name + ".svg"), "w") as f:
            f.write(svg(ents))
        x0, y0, x1, y1 = bbox(ents)
        bc, n, bolt_d, _, _ = FLANGE[nps]
        slack = (bc - bolt_d) - od
        note = "exact" if abs(slack) < 1e-9 else "%+.3f" % slack
        print("%-34s %8.3f %10.3f %14s" % (name + ".dxf", od, x1 - x0, note))

    print("\n%d files written to %s" % (len(jobs), out))


if __name__ == "__main__":
    main()
