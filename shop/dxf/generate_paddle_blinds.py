#!/usr/bin/env python3
"""
Paddle blind / line blank DXF generator  -- State of the Arc Welding and Services LLC

Generates flat-pattern (2D) cutting profiles for ASME B16.48-style line blanks:

    spade   - solid disc with a handle           (blocks flow)
    spacer  - bored ring with a handle           (passes flow)
    fig8    - spectacle blind, solid + ring      (flip to change service)

Geometry is driven entirely by the SIZES table below, so new sizes or a
different pressure class can be added by editing one dict.

No third-party dependencies. Writes AutoCAD R12 (AC1009) ASCII DXF using only
LINE / ARC / CIRCLE / TEXT entities, which every laser and plasma CAM package
reads without translation. Also emits an SVG preview of each part.

    python3 generate_paddle_blinds.py [output_dir]

Units are INCHES. Geometry is nominal -- apply kerf compensation in CAM.
"""

import math
import os
import sys

CLASS = 150

# ---------------------------------------------------------------------------
# Size table.
#
# disc_od   ASME B16.5 Class 150 raised-face OD. The blank seats on the gasket
#           face and clears the bolts, so this is the disc diameter.
# flange_od ASME B16.5 Class 150 flange OD -- the handle must project past it.
# bore      Schedule 40 pipe ID; used for spacer / fig-8 ring bores.
# proj      How far the handle tip sticks out past the flange OD.
# hw_w      Handle width. Sized to pass between two adjacent bolts.
# hole      Tag / hanging hole in the handle tip.
# fillet    Fillet radius where the handle meets the disc.
# gap       Fig-8 only: clear gap between the two discs.
# ---------------------------------------------------------------------------
SIZES = [
    # nps   label      disc_od flange_od  bore    proj  hw_w  hole  fillet gap
    ("1.5", '1-1/2"',   2.88,   5.00,    1.610,  1.25, 1.00, 0.375, 0.25, 1.00),
    ("2",   '2"',       3.62,   6.00,    2.067,  1.25, 1.25, 0.500, 0.25, 1.00),
    ("3",   '3"',       5.00,   7.50,    3.068,  1.25, 1.50, 0.500, 0.25, 1.00),
    ("4",   '4"',       6.19,   9.00,    4.026,  1.50, 1.50, 0.500, 0.25, 1.00),
    ("6",   '6"',       8.50,  11.00,    6.065,  1.50, 2.00, 0.625, 0.375, 1.50),
    ("8",   '8"',      10.62,  13.50,    7.981,  2.00, 2.00, 0.625, 0.375, 1.50),
    ("10",  '10"',     12.75,  16.00,   10.020,  2.00, 2.50, 0.750, 0.375, 1.50),
]

CUT_LAYER = "CUT"
ETCH_LAYER = "ETCH"

# Rough width of one character as a fraction of text height, including spacing.
CHAR_W = 0.75


# ---------------------------------------------------------------------------
# Entity model. Everything downstream (DXF, SVG) consumes these.
# ---------------------------------------------------------------------------

def line(x1, y1, x2, y2, layer=CUT_LAYER):
    return ("LINE", layer, x1, y1, x2, y2)


def arc(cx, cy, r, a0, a1, layer=CUT_LAYER):
    """Arc swept counter-clockwise from a0 to a1, degrees."""
    return ("ARC", layer, cx, cy, r, a0 % 360.0, a1 % 360.0)


def circle(cx, cy, r, layer=CUT_LAYER):
    return ("CIRCLE", layer, cx, cy, r)


def text(s, x, y, h, layer=ETCH_LAYER):
    return ("TEXT", layer, x, y, h, s)


def deg(rad):
    return math.degrees(rad)


# ---------------------------------------------------------------------------
# Handle / web attachment geometry
# ---------------------------------------------------------------------------

def attach(disc_r, half_w, fillet):
    """
    Solve the concave fillet blending a straight handle edge into the disc OD.

    The fillet circle sits outside the disc, tangent to it, and tangent to the
    handle edge y = half_w. Returns the fillet centre x, its centre y, and the
    tangent point on the disc.
    """
    cy = half_w + fillet
    cx = math.sqrt((disc_r + fillet) ** 2 - cy ** 2)
    k = disc_r / (disc_r + fillet)          # project centre back onto the disc
    return cx, cy, (cx * k, cy * k)


def handle_side(disc_r, half_w, fillet, cx, cy, tan_pt, x_far, flip=1.0, at=0.0):
    """
    Fillet + straight edge for one side of a handle rooted at a disc centred on
    (at, 0) and running toward +x. flip=+1 upper edge, flip=-1 lower edge.
    """
    px, py = tan_pt
    ents = []
    if flip > 0:
        a0 = deg(math.atan2(py - cy, px - cx))
        ents.append(arc(at + cx, cy, fillet, a0, 270.0))
        ents.append(line(at + cx, half_w, x_far, half_w))
    else:
        a1 = deg(math.atan2(cy - py, px - cx))
        ents.append(line(x_far, -half_w, at + cx, -half_w))
        ents.append(arc(at + cx, -cy, fillet, 90.0, a1))
    return ents


def fit_text(s, box_len, box_h, min_h=0.10, max_h=0.50):
    """Largest text height that fits s into the box, or None if it can't."""
    h = min(box_h, max_h, (box_len * 0.92) / (len(s) * CHAR_W))
    return h if h >= min_h else None


# ---------------------------------------------------------------------------
# Part builders
# ---------------------------------------------------------------------------

def build_paddle(spec, bored):
    """Spade (bored=False) or ring spacer (bored=True)."""
    _, label, disc_od, flange_od, bore, proj, w, hole, fillet, _ = spec
    disc_r = disc_od / 2.0
    half_w = w / 2.0
    tip_x = flange_od / 2.0 + proj          # far end of the handle
    cap_cx = tip_x - half_w                 # centre of the rounded tip
    cx, cy, tan_pt = attach(disc_r, half_w, fillet)
    theta = deg(math.atan2(tan_pt[1], tan_pt[0]))

    ents = [arc(0, 0, disc_r, theta, -theta)]
    ents += handle_side(disc_r, half_w, fillet, cx, cy, tan_pt, cap_cx, +1)
    ents.append(arc(cap_cx, 0, half_w, 270.0, 90.0))
    ents += handle_side(disc_r, half_w, fillet, cx, cy, tan_pt, cap_cx, -1)
    ents.append(circle(cap_cx, 0, hole / 2.0))
    if bored:
        ents.append(circle(0, 0, bore / 2.0))

    kind = "SPACER" if bored else "SPADE"

    # Short tag on the handle -- this is the face you read once it is installed.
    tag = "%s %d" % (label, CLASS)
    x0 = cx + 0.10
    x1 = cap_cx - hole / 2.0 - 0.10
    h = fit_text(tag, x1 - x0, w * 0.40)
    if h:
        ents.append(text(tag, (x0 + x1) / 2.0, 0.0, h))

    # Full label on the disc face -- only the spade has solid material there.
    if not bored:
        full = "NPS %s CL%d %s" % (label, CLASS, kind)
        h = fit_text(full, disc_od * 0.86, disc_od * 0.12)
        if h:
            ents.append(text(full, 0.0, 0.0, h))

    return ents, "NPS%s_CL%d_%s" % (spec[0], CLASS, kind.lower())


def build_fig8(spec):
    """Spectacle blind: solid disc at the origin, bored ring at +x."""
    _, label, disc_od, flange_od, bore, _, w, _, fillet, gap = spec
    disc_r = disc_od / 2.0
    half_w = w / 2.0
    ctr = disc_od + gap                     # centre-to-centre
    cx, cy, tan_pt = attach(disc_r, half_w, fillet)
    theta = deg(math.atan2(tan_pt[1], tan_pt[0]))
    px, py = tan_pt

    if ctr - cx <= cx:
        raise ValueError("fig-8 web too short for NPS %s" % spec[0])

    ents = [
        # Solid disc, around the far side.
        arc(0, 0, disc_r, theta, -theta),
        # Upper web: fillet out of the solid disc, across, into the ring.
        arc(cx, cy, fillet, deg(math.atan2(py - cy, px - cx)), 270.0),
        line(cx, half_w, ctr - cx, half_w),
        arc(ctr - cx, cy, fillet, 270.0, deg(math.atan2(py - cy, cx - px))),
        # Ring disc, around the far side.
        arc(ctr, 0, disc_r, 180.0 + theta, 180.0 - theta),
        # Lower web, coming back.
        arc(ctr - cx, -cy, fillet, deg(math.atan2(cy - py, cx - px)), 90.0),
        line(ctr - cx, -half_w, cx, -half_w),
        arc(cx, -cy, fillet, 90.0, deg(math.atan2(cy - py, px - cx))),
        # Bore through the ring half.
        circle(ctr, 0, bore / 2.0),
    ]

    full = "NPS %s CL%d FIG-8" % (label, CLASS)
    h = fit_text(full, disc_od * 0.86, disc_od * 0.12)
    if h:
        ents.append(text(full, 0.0, 0.0, h))

    tag = "%s %d" % (label, CLASS)
    h = fit_text(tag, (ctr - 2 * cx) * 0.95, w * 0.40)
    if h:
        ents.append(text(tag, ctr / 2.0, 0.0, h))

    return ents, "NPS%s_CL%d_fig8" % (spec[0], CLASS)


# ---------------------------------------------------------------------------
# Bounding box
# ---------------------------------------------------------------------------

def bbox(ents):
    xs, ys = [], []
    for e in ents:
        if e[0] == "LINE":
            xs += [e[2], e[4]]
            ys += [e[3], e[5]]
        elif e[0] == "ARC":
            # Conservative: use the full circle. Only feeds header extents.
            xs += [e[2] - e[4], e[2] + e[4]]
            ys += [e[3] - e[4], e[3] + e[4]]
        elif e[0] == "CIRCLE":
            xs += [e[2] - e[4], e[2] + e[4]]
            ys += [e[3] - e[4], e[3] + e[4]]
    return min(xs), min(ys), max(xs), max(ys)


# ---------------------------------------------------------------------------
# DXF writer (AutoCAD R12 / AC1009 ASCII)
# ---------------------------------------------------------------------------

def g(code, value):
    if isinstance(value, float):
        return "%d\n%.6f\n" % (code, value)
    return "%d\n%s\n" % (code, value)


def dxf(ents):
    x0, y0, x1, y1 = bbox(ents)
    o = []
    o.append(g(0, "SECTION") + g(2, "HEADER"))
    o.append(g(9, "$ACADVER") + g(1, "AC1009"))
    o.append(g(9, "$INSUNITS") + g(70, 1))          # 1 = inches
    o.append(g(9, "$MEASUREMENT") + g(70, 0))       # 0 = imperial
    o.append(g(9, "$LUNITS") + g(70, 2))
    o.append(g(9, "$EXTMIN") + g(10, x0) + g(20, y0) + g(30, 0.0))
    o.append(g(9, "$EXTMAX") + g(10, x1) + g(20, y1) + g(30, 0.0))
    o.append(g(9, "$LIMMIN") + g(10, x0) + g(20, y0))
    o.append(g(9, "$LIMMAX") + g(10, x1) + g(20, y1))
    o.append(g(0, "ENDSEC"))

    o.append(g(0, "SECTION") + g(2, "TABLES"))
    o.append(g(0, "TABLE") + g(2, "LTYPE") + g(70, 1))
    o.append(g(0, "LTYPE") + g(2, "CONTINUOUS") + g(70, 0) +
             g(3, "Solid line") + g(72, 65) + g(73, 0) + g(40, 0.0))
    o.append(g(0, "ENDTAB"))
    o.append(g(0, "TABLE") + g(2, "LAYER") + g(70, 2))
    for name, color in ((CUT_LAYER, 7), (ETCH_LAYER, 1)):
        o.append(g(0, "LAYER") + g(2, name) + g(70, 0) +
                 g(62, color) + g(6, "CONTINUOUS"))
    o.append(g(0, "ENDTAB"))
    o.append(g(0, "TABLE") + g(2, "STYLE") + g(70, 1))
    o.append(g(0, "STYLE") + g(2, "STANDARD") + g(70, 0) + g(40, 0.0) +
             g(41, 1.0) + g(50, 0.0) + g(71, 0) + g(42, 0.2) +
             g(3, "txt") + g(4, ""))
    o.append(g(0, "ENDTAB"))
    o.append(g(0, "ENDSEC"))

    o.append(g(0, "SECTION") + g(2, "ENTITIES"))
    for e in ents:
        k, layer = e[0], e[1]
        if k == "LINE":
            o.append(g(0, "LINE") + g(8, layer) +
                     g(10, e[2]) + g(20, e[3]) + g(30, 0.0) +
                     g(11, e[4]) + g(21, e[5]) + g(31, 0.0))
        elif k == "ARC":
            o.append(g(0, "ARC") + g(8, layer) +
                     g(10, e[2]) + g(20, e[3]) + g(30, 0.0) +
                     g(40, e[4]) + g(50, e[5]) + g(51, e[6]))
        elif k == "CIRCLE":
            o.append(g(0, "CIRCLE") + g(8, layer) +
                     g(10, e[2]) + g(20, e[3]) + g(30, 0.0) + g(40, e[4]))
        elif k == "TEXT":
            o.append(g(0, "TEXT") + g(8, layer) +
                     g(10, e[2]) + g(20, e[3]) + g(30, 0.0) +
                     g(40, e[4]) + g(1, e[5]) + g(50, 0.0) + g(41, 1.0) +
                     g(7, "STANDARD") +
                     g(72, 1) + g(73, 2) +
                     g(11, e[2]) + g(21, e[3]) + g(31, 0.0))
    o.append(g(0, "ENDSEC"))
    o.append(g(0, "EOF"))
    return "".join(o)


# ---------------------------------------------------------------------------
# SVG preview
# ---------------------------------------------------------------------------

def svg(ents, px_per_in=42.0, pad=0.35):
    x0, y0, x1, y1 = bbox(ents)
    x0 -= pad; y0 -= pad; x1 += pad; y1 += pad
    w, h = x1 - x0, y1 - y0

    def pt(x, y):                       # DXF y-up -> SVG y-down
        return (x - x0), (y1 - y)

    body = []
    for e in ents:
        if e[0] == "LINE":
            ax, ay = pt(e[2], e[3]); bx, by = pt(e[4], e[5])
            body.append('<line x1="%.4f" y1="%.4f" x2="%.4f" y2="%.4f"/>'
                        % (ax, ay, bx, by))
        elif e[0] == "CIRCLE":
            cx, cy = pt(e[2], e[3])
            body.append('<circle cx="%.4f" cy="%.4f" r="%.4f"/>'
                        % (cx, cy, e[4]))
        elif e[0] == "ARC":
            cx, cy, r, a0, a1 = e[2], e[3], e[4], e[5], e[6]
            sweep = (a1 - a0) % 360.0
            sx, sy = pt(cx + r * math.cos(math.radians(a0)),
                        cy + r * math.sin(math.radians(a0)))
            ex, ey = pt(cx + r * math.cos(math.radians(a1)),
                        cy + r * math.sin(math.radians(a1)))
            large = 1 if sweep > 180.0 else 0
            # CCW in DXF becomes CW in SVG's flipped y axis.
            body.append('<path d="M %.4f %.4f A %.4f %.4f 0 %d 0 %.4f %.4f"/>'
                        % (sx, sy, r, r, large, ex, ey))
        elif e[0] == "TEXT":
            cx, cy = pt(e[2], e[3])
            body.append('<text x="%.4f" y="%.4f" font-size="%.4f" fill="#c0392b" '
                        'stroke="none" text-anchor="middle" '
                        'dominant-baseline="central" '
                        'font-family="monospace">%s</text>'
                        % (cx, cy, e[4], e[5]))

    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %.4f %.4f" '
        'width="%.1f" height="%.1f">\n'
        '<rect width="100%%" height="100%%" fill="#ffffff"/>\n'
        '<g fill="none" stroke="#111111" stroke-width="%.4f">\n%s\n</g>\n</svg>\n'
        % (w, h, w * px_per_in, h * px_per_in, 0.02, "\n".join(body))
    )


# ---------------------------------------------------------------------------

def main():
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "paddle-blinds-cl%d" % CLASS)
    os.makedirs(out, exist_ok=True)

    parts = []
    for spec in SIZES:
        parts.append(build_paddle(spec, bored=False))
        parts.append(build_paddle(spec, bored=True))
        parts.append(build_fig8(spec))

    for ents, name in parts:
        with open(os.path.join(out, name + ".dxf"), "w") as f:
            f.write(dxf(ents))
        with open(os.path.join(out, name + ".svg"), "w") as f:
            f.write(svg(ents))
        x0, y0, x1, y1 = bbox(ents)
        print("%-26s %6.2f x %6.2f in" % (name, x1 - x0, y1 - y0))

    print("\n%d DXF files written to %s" % (len(parts), out))


if __name__ == "__main__":
    main()
