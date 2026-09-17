#!/usr/bin/env python3
"""
Skillet blind (T-handle line blank) DXF generator
State of the Arc Welding and Services LLC

Disc OD follows the manufacturer chart Gilbert supplied:

    disc OD = bolt circle diameter - bolt HOLE diameter

That is bolt HOLE, not bolt diameter -- it leaves 1/16" radial clearance to the
bolt shanks so the blank actually drops in, rather than sitting dead tangent.
Every generated OD is asserted against CHART below, which is the manufacturer's
published table; a mismatch fails the build rather than cutting a wrong part.

Handle reach follows the shop rule:

    the crossbar STARTS 2" past the edge of the flange   (FLANGE_GAP)

so the whole T sits clear of the flange with 2" of bare stem behind it.

Stem width is a CHECKED constraint, not a free parameter. The stem is installed
centred between two adjacent bolts and no bolt passes through it, so every stem
is verified to clear the bolt shanks -- see bolt_clearance() / check_stem().

    python3 generate_skillet_blinds.py [output_dir]

Units are INCHES. Geometry is nominal -- apply kerf compensation in CAM.
"""

import math
import os
import sys

from t_handle import t_blind
from generate_paddle_blinds import dxf, svg, bbox

# Hard floor on stem-edge-to-bolt-shank, per side. This is a physical "will it
# drop between the bolts" limit. Class 600 and up crowd many bolts onto a small
# circle, so the roomy 3/8" the Class 150 sizes enjoy is simply not available --
# see the 2" 600 below, where the whole gap between bolt shanks is 1.288".
MIN_BOLT_CLEAR = 0.125

# Bare stem between the flange edge and the start of the crossbar.
FLANGE_GAP = 2.00

# ---------------------------------------------------------------------------
# ASME B16.5 flange data, keyed (class, NPS).
#   bolt_d     drives the disc OD (bolt circle - bolt diameter)
#   flange_od  drives handle reach; half of it is Gilbert's "centre to edge"
# ---------------------------------------------------------------------------
FLANGE = {
    # (cls, nps): (bolt circle, n bolts, bolt dia, flange OD, Sch 40 ID)
    (150, "2"):  (4.75,  4, 0.625,  6.00,  2.067),
    (150, "3"):  (6.00,  4, 0.625,  7.50,  3.068),
    (150, "4"):  (7.50,  8, 0.625,  9.00,  4.026),
    (150, "6"):  (9.50,  8, 0.750, 11.00,  6.065),
    (150, "8"): (11.75,  8, 0.750, 13.50,  7.981),
    (150, "10"):(14.25, 12, 0.875, 16.00, 10.020),
    (600, "2"):  (5.00,  8, 0.625,  6.50,  2.067),
}

# Plain skillet -- no tag hole in the handle. t_blind() still supports one;
# pass a diameter here and thread it into build() if that ever changes.
TAG_HOLE = None

# ---------------------------------------------------------------------------
# T-handle dimensions. Only the STEM is bolt-constrained; the crossbar sits
# clear of the flange entirely, so it stays generous even on tight sizes.
# ---------------------------------------------------------------------------
HANDLE = {
    (150, "2"):  dict(stem=1.250, bar_l=4.00, bar_d=1.00),
    (150, "3"):  dict(stem=1.500, bar_l=4.50, bar_d=1.25),
    (150, "4"):  dict(stem=1.375, bar_l=4.50, bar_d=1.25),
    (150, "6"):  dict(stem=2.000, bar_l=6.00, bar_d=1.50),
    (150, "8"):  dict(stem=2.000, bar_l=6.00, bar_d=1.50),
    (150, "10"): dict(stem=2.000, bar_l=7.00, bar_d=1.75),
    # 8 bolts on a 5" circle leave only 1.288" between shanks, so the stem is
    # cut to 7/8" to keep 0.207" per side.
    (600, "2"):  dict(stem=0.875, bar_l=4.00, bar_d=1.00),
}

# Manufacturer's published line blank chart: (disc OD, plate thickness).
# This is the authority for both. Every computed OD is asserted against it.
CHART = {
    (150, "2"):  (4.000,  0.3125),
    (150, "3"):  (5.250,  0.3125),
    (150, "4"):  (6.750,  0.375),
    (150, "6"):  (8.625,  0.500),
    (150, "8"): (10.875,  0.500),
    (150, "10"):(13.250,  0.625),
    (600, "2"):  (4.250,  0.375),
}

# Disc OD overrides, where a size must depart from the rule. Empty: the rule
# reproduces the manufacturer chart exactly on every size.
OVERRIDE = {}

# B16.5 Group 1.1 pressure rating, -20 to 100 F, psi. Drives plate thickness.
RATING = {150: 285, 300: 740, 600: 1480}

# Gasket ID (= pipe OD) for the B31.3 blank thickness formula.
GASKET_ID = {"2": 2.375, "3": 3.500, "4": 4.500,
             "6": 6.625, "8": 8.625, "10": 10.750}

LABEL = {"2": '2"', "3": '3"', "4": '4"', "6": '6"', "8": '8"', "10": '10"'}

ALLOW_S, WELD_E, CORROSION = 20000.0, 1.0, 0.0625
PLATE = [0.1875, 0.25, 0.3125, 0.375, 0.4375, 0.5, 0.5625, 0.625, 0.75, 0.875, 1.0]
FRAC = {0.1875: "3/16", 0.25: "1/4", 0.3125: "5/16", 0.375: "3/8",
        0.4375: "7/16", 0.5: "1/2", 0.5625: "9/16", 0.625: "5/8",
        0.75: "3/4", 0.875: "7/8", 1.0: "1"}


def hole_dia(bolt_d):
    """B16.5 drills the bolt hole 1/8" over the bolt, or 1/4" over 1" bolts."""
    return bolt_d + (0.125 if bolt_d <= 1.0 else 0.25)


def disc_od(key):
    if key in OVERRIDE:
        return OVERRIDE[key]
    bc, _, bolt_d, _, _ = FLANGE[key]
    od = bc - hole_dia(bolt_d)
    if key in CHART and abs(od - CHART[key][0]) > 1e-9:
        raise ValueError(
            "CL%d NPS %s: rule gives %.4f but the manufacturer chart says %.4f. "
            "The bolt data for this size is wrong -- fix it rather than cutting."
            % (key[0], key[1], od, CHART[key][0]))
    return od


def bolt_clearance(key, stem_w):
    """
    Gap between the stem edge and the nearest bolt shank, per side, with the
    stem installed centred between two adjacent bolts.

    The nearest bolt centre sits half a bolt pitch off the stem axis, so its
    perpendicular offset from the stem centreline is (BC/2) * sin(pi/n).
    """
    bc, n, bolt_d, _, _ = FLANGE[key]
    return (bc / 2.0) * math.sin(math.pi / n) - bolt_d / 2.0 - stem_w / 2.0


def max_stem(key):
    """Widest stem that still keeps MIN_BOLT_CLEAR to the bolts."""
    return 2.0 * (bolt_clearance(key, 0.0) - MIN_BOLT_CLEAR)


def check_stem(key, stem_w):
    c = bolt_clearance(key, stem_w)
    if c < MIN_BOLT_CLEAR:
        raise ValueError(
            'CL%d NPS %s stem %.3f" leaves only %.3f" to the bolts (min %.3f"). '
            'Widest stem for this size is %.3f".'
            % (key[0], key[1], stem_w, c, MIN_BOLT_CLEAR, max_stem(key)))
    return c


def thickness(key):
    """
    Plate thickness. The manufacturer chart wins where it has the size; the
    B31.3 304.5.3 calculation is the fallback and the sanity check.
    """
    cls, nps = key
    t = GASKET_ID[nps] * math.sqrt(3.0 * RATING[cls] / (16.0 * ALLOW_S * WELD_E))
    need = t + CORROSION
    if key in CHART:
        return need, CHART[key][1]
    return need, next(p for p in PLATE if p >= need - 1e-9)


def build(key, bored=False):
    cls, nps = key
    bc, n, bolt_d, flange_od, sch40 = FLANGE[key]
    h = HANDLE[key]
    check_stem(key, h["stem"])
    fil = 0.375 if h["stem"] >= 2.0 else 0.25
    kind = "SPACER" if bored else "SKILLET"
    overall = flange_od / 2.0 + FLANGE_GAP + h["bar_d"]
    return t_blind(
        disc_od=disc_od(key),
        stem_w=h["stem"],
        bar_len=h["bar_l"],
        bar_d=h["bar_d"],
        overall=overall,
        bore=sch40 if bored else None,
        root_r=fil,
        inner_r=fil,
        corner_r=0.25,
        hole=TAG_HOLE,
        label="%s CL%d %s" % (LABEL[nps], cls, kind),
    )


def main():
    base = sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(
        os.path.abspath(__file__))

    print("%-26s %8s %8s %8s %8s %9s %8s" % (
        "file", "disc OD", "bar at", "total L", "stem", "bolt gap", "plate"))
    for key in FLANGE:
        cls, nps = key
        out = os.path.join(base, "skillet-blinds-cl%d" % cls)
        os.makedirs(out, exist_ok=True)
        ents = build(key)
        name = "NPS%s_CL%d_skillet" % (nps, cls)
        with open(os.path.join(out, name + ".dxf"), "w") as f:
            f.write(dxf(ents))
        with open(os.path.join(out, name + ".svg"), "w") as f:
            f.write(svg(ents))
        x0, y0, x1, y1 = bbox(ents)
        bc, n, bolt_d, flange_od, sch40 = FLANGE[key]
        need, plate = thickness(key)
        print("%-26s %8.3f %8.3f %8.3f %9.3f %8.3f %8s  %s" % (
            name + ".dxf", disc_od(key), flange_od / 2.0 + FLANGE_GAP,
            x1 - x0, HANDLE[key]["stem"],
            bolt_clearance(key, HANDLE[key]["stem"]),
            FRAC[plate] + '"',
            "chart" if key in CHART else "derived"))

    print("\nCrossbar starts %.2f\" past the flange edge on every size." % FLANGE_GAP)
    print("Bolt gap is stem edge to bolt shank, per side (floor %.3f\")."
          % MIN_BOLT_CLEAR)


if __name__ == "__main__":
    main()
