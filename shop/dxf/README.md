# Paddle Blinds — ASME B16.48 style, Class 150

> ## ⚠ SUPERSEDED — DO NOT CUT FROM THIS SET
>
> These files use the ASME B16.48 raised-face OD for the disc, which is
> **undersized** against this shop's practice, and they have round-end paddle
> handles rather than T handles.
>
> The current set is `../skillet-blinds-cl150/` — T handle, disc OD taken as
> bolt circle minus bolt diameter. Use that one.
>
> Kept only for the dimensional reference tables below.

Flat-pattern DXF cutting profiles for line blanks in 1-1/2", 2", 3", 4", 6", 8"
and 10", sized for **ASME B16.5 Class 150 raised-face flanges**.

Three parts per size, 21 files total:

| Suffix | Part | What it does |
|---|---|---|
| `_spade` | Paddle blind / spade | Solid disc with a handle — **blocks** flow |
| `_spacer` | Paddle spacer / ring spacer | Bored ring with a handle — **passes** flow |
| `_fig8` | Spectacle blind (figure-8) | Solid + bored halves on one web — flip to change service |

Files are named `NPS<size>_CL150_<part>.dxf`, e.g. `NPS6_CL150_spade.dxf`.
Each has a matching `.svg` for quick preview in a browser.

---

## Before you cut

- **Units are inches.** Header is set to imperial (`$INSUNITS = 1`).
- **Geometry is nominal.** No kerf compensation is applied — set the lead-in and
  kerf offset in your CAM as usual.
- **Two layers.** `CUT` holds all the profile geometry and holes. `ETCH` holds
  part-identification text only. If your CAM selects all layers by default,
  either assign `ETCH` to a marking/scribe operation or delete the layer.
- **Entities are LINE / ARC / CIRCLE only**, written as AutoCAD R12 (AC1009).
  No splines, no polylines, nothing that needs translating. Every profile has
  been verified as a fully closed contour.

---

## Dimensions

### A. Cut geometry

| NPS | Disc OD | Handle W | Handle proj. | Tip-to-back | Tag hole | Fillet R | Bore (Sch 40) |
|---|---|---|---|---|---|---|---|
| 1-1/2" | 2.88 | 1.00 | 1.25 | 5.19 | 0.375 | 0.250 | 1.610 |
| 2" | 3.62 | 1.25 | 1.25 | 6.06 | 0.500 | 0.250 | 2.067 |
| 3" | 5.00 | 1.50 | 1.25 | 7.50 | 0.500 | 0.250 | 3.068 |
| 4" | 6.19 | 1.50 | 1.50 | 9.10 | 0.500 | 0.250 | 4.026 |
| 6" | 8.50 | 2.00 | 1.50 | 11.25 | 0.625 | 0.375 | 6.065 |
| 8" | 10.62 | 2.00 | 2.00 | 14.06 | 0.625 | 0.375 | 7.981 |
| 10" | 12.75 | 2.50 | 2.00 | 16.38 | 0.750 | 0.375 | 10.020 |

### B. Fit checks against ASME B16.5 Class 150 flanges

| NPS | Flange OD | Bolt circle | Bolts | Clear bore inside bolts | Disc OD | Radial clearance | Gap between bolts | Handle W | Margin |
|---|---|---|---|---|---|---|---|---|---|
| 1-1/2" | 5.00 | 3.88 | 4 x 1/2" | 3.255 | 2.88 | +0.188 | 2.12 | 1.00 | +1.12 |
| 2" | 6.00 | 4.75 | 4 x 5/8" | 4.000 | 3.62 | +0.190 | 2.61 | 1.25 | +1.36 |
| 3" | 7.50 | 6.00 | 4 x 5/8" | 5.250 | 5.00 | +0.125 | 3.49 | 1.50 | +1.99 |
| 4" | 9.00 | 7.50 | 8 x 5/8" | 6.750 | 6.19 | +0.280 | 2.12 | 1.50 | +0.62 |
| 6" | 11.00 | 9.50 | 8 x 3/4" | 8.625 | 8.50 | +0.062 | 2.76 | 2.00 | +0.76 |
| 8" | 13.50 | 11.75 | 8 x 3/4" | 10.875 | 10.62 | +0.128 | 3.62 | 2.00 | +1.62 |
| 10" | 16.00 | 14.25 | 12 x 7/8" | 13.250 | 12.75 | +0.250 | 2.69 | 2.50 | +0.19 |

### C. Plate thickness (calculated, not a table lookup)

| NPS | Gasket ID | Calculated min t | + 1/16" CA | Recommended plate |
|---|---|---|---|---|
| 1-1/2" | 1.900 | 0.098 | 0.161 | **3/16"** |
| 2" | 2.375 | 0.123 | 0.185 | **3/16"** |
| 3" | 3.500 | 0.181 | 0.243 | **1/4"** |
| 4" | 4.500 | 0.233 | 0.295 | **5/16"** |
| 6" | 6.625 | 0.342 | 0.405 | **7/16"** |
| 8" | 8.625 | 0.446 | 0.508 | **9/16"** |
| 10" | 10.750 | 0.556 | 0.618 | **5/8"** |

K = sqrt(3P / 16SE) = 0.05169  (P=285 psi, S=20000 psi, E=1)

### D. Fig-8 overall

| NPS | Centre-to-centre | Overall length | Web width | Web straight |
|---|---|---|---|---|
| 1-1/2" | 3.88 | 6.76 | 1.00 | 0.85 |
| 2" | 4.62 | 8.24 | 1.25 | 0.89 |
| 3" | 6.00 | 11.00 | 1.50 | 0.88 |
| 4" | 7.19 | 13.38 | 1.50 | 0.81 |
| 6" | 10.00 | 18.50 | 2.00 | 1.17 |
| 8" | 12.12 | 22.74 | 2.00 | 1.09 |
| 10" | 14.25 | 27.00 | 2.50 | 1.15 |

---

## How the geometry was derived

**Disc OD** is the ASME B16.5 Class 150 raised-face diameter for each size. That
is the gasket seating surface, so the blank seats correctly and still clears the
bolts. Table B shows the check both ways: the disc fits inside the bolts with
positive radial clearance, and the handle passes between two adjacent bolts with
positive margin, for every size.

> **Watch the 6".** Radial clearance there is +0.062" — about 1/32" per side.
> That is inherent to Class 150 6" (8.50" raised face inside an 8.625" clear
> bore), not a drafting choice. Hold the disc OD to the low side of tolerance
> and check the fit on the first one off the table.

**Handle length** puts the tip 1-1/4" to 2" past the flange OD so it stays
visible with the joint bolted up — that is the whole point of a paddle. The
handle meets the disc through a filleted root rather than a sharp corner, so
there is no notch to start a crack when someone levers on it.

**Bore** on spacers and fig-8 ring halves is the Schedule 40 ID, so the spacer
does not restrict the line. If you run a different schedule, change `bore` in
the size table and regenerate.

**Thickness** in Table C is *calculated*, per ASME B31.3 §304.5.3:

    t = d_g x sqrt(3P / 16SE) + c

at P = 285 psi (Class 150 rating, -20 to 100°F), S = 20,000 psi (A516-70,
E = 1.0), plus a 1/16" corrosion allowance, rounded up to standard plate.

**These thicknesses are a starting point, not a design.** They assume ambient
temperature and full Class 150 rating. Class 150 derates steeply with
temperature — at 400°F it is down to 200 psi, at 600°F to 140 psi. Confirm the
actual design pressure, temperature and material for the line before you commit
to plate, especially on anything in regulated or high-energy service. The DXFs
are 2D profiles, so thickness does not affect the cut file either way.

---

## Regenerating or adding sizes

`generate_paddle_blinds.py` is plain Python 3 with no dependencies:

```bash
python3 generate_paddle_blinds.py [output_dir]
```

Everything is driven by the `SIZES` table at the top of the script — one row per
size, holding disc OD, flange OD, bore, handle projection, handle width, tag
hole, fillet and fig-8 gap. Add a row to add a size. Change `CLASS` and the
disc/flange columns to build a different pressure class.
