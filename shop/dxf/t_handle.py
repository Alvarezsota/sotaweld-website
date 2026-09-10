"""T-handle skillet blind geometry. Shares the DXF/SVG writers with v1."""
import math
from generate_paddle_blinds import line, arc, circle, text, deg, attach, dxf, svg, bbox, CUT_LAYER


def t_blind(disc_od, stem_w, bar_len, bar_d, overall, bore=None,
            root_r=0.25, inner_r=0.375, corner_r=0.25, hole=None, label=None):
    """
    Skillet blind with a T handle.

      disc_od   disc outside diameter
      stem_w    width of the stem
      bar_len   crossbar length (tip to tip, across the T)
      bar_d     crossbar depth (along the stem axis)
      overall   disc centre to the OUTER face of the crossbar
      bore      None for a solid blind, or a diameter for a spacer
      root_r    fillet where the stem meets the disc
      inner_r   fillet in the two reentrant corners under the T
      corner_r  radius on the four crossbar corners
      hole      optional tag hole diameter, placed in the stem
    """
    R = disc_od / 2.0
    sw = stem_w / 2.0
    bl = bar_len / 2.0
    x_out = overall
    x_in = overall - bar_d

    cx, cy, tp = attach(R, sw, root_r)          # stem-to-disc fillet
    theta = deg(math.atan2(tp[1], tp[0]))

    # --- sanity checks: fail loudly rather than emit a broken profile --------
    if x_in - inner_r <= cx:
        raise ValueError("stem too short: crossbar at %.3f overruns the disc "
                         "fillet ending at %.3f" % (x_in - inner_r, cx))
    if bar_len <= stem_w + 2 * inner_r:
        raise ValueError("crossbar %.3f too short for stem %.3f + fillets"
                         % (bar_len, stem_w))
    if bar_d <= 2 * corner_r:
        raise ValueError("crossbar depth %.3f too small for corner radii" % bar_d)
    if bore is not None and bore >= disc_od - 0.25:
        raise ValueError("bore %.3f too close to disc OD %.3f" % (bore, disc_od))

    e = []
    # Disc, around the back.
    e.append(arc(0, 0, R, theta, -theta))
    # Upper: root fillet -> stem -> reentrant fillet
    e.append(arc(cx, cy, root_r, deg(math.atan2(tp[1] - cy, tp[0] - cx)), 270.0))
    e.append(line(cx, sw, x_in - inner_r, sw))
    e.append(arc(x_in - inner_r, sw + inner_r, inner_r, 270.0, 360.0))
    # Upper crossbar: inner face -> corner -> top -> corner
    e.append(line(x_in, sw + inner_r, x_in, bl - corner_r))
    e.append(arc(x_in + corner_r, bl - corner_r, corner_r, 90.0, 180.0))
    e.append(line(x_in + corner_r, bl, x_out - corner_r, bl))
    e.append(arc(x_out - corner_r, bl - corner_r, corner_r, 0.0, 90.0))
    # Outer face of the crossbar.
    e.append(line(x_out, bl - corner_r, x_out, -(bl - corner_r)))
    # Lower crossbar, coming back.
    e.append(arc(x_out - corner_r, -(bl - corner_r), corner_r, 270.0, 360.0))
    e.append(line(x_out - corner_r, -bl, x_in + corner_r, -bl))
    e.append(arc(x_in + corner_r, -(bl - corner_r), corner_r, 180.0, 270.0))
    e.append(line(x_in, -(bl - corner_r), x_in, -(sw + inner_r)))
    # Lower: reentrant fillet -> stem -> root fillet
    e.append(arc(x_in - inner_r, -(sw + inner_r), inner_r, 0.0, 90.0))
    e.append(line(x_in - inner_r, -sw, cx, -sw))
    e.append(arc(cx, -cy, root_r, 90.0, deg(math.atan2(cy - tp[1], tp[0] - cx))))

    if bore:
        e.append(circle(0, 0, bore / 2.0))
    if hole:
        e.append(circle((cx + x_in - inner_r) / 2.0, 0, hole / 2.0))
    if label:
        h = min(0.5, disc_od * 0.12, (disc_od * 0.86 * 0.92) / (len(label) * 0.75))
        if h >= 0.10:
            e.append(text(label, 0.0, 0.0, h))
    return e
