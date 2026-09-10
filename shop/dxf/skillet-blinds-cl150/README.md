# Skillet Blinds — T handle, Class 150

Flat-pattern DXF cutting profiles for T-handle skillet blinds (line blanks) in
1-1/2", 2", 3", 4", 6", 8" and 10", for ASME B16.5 Class 150 flanges.

## Disc OD rule

    disc OD = bolt circle diameter - bolt diameter

The blank seats against the **inside of the bolt shanks**, so the bolts capture
and centre it. Note that is bolt *diameter*, not bolt *hole* diameter — the
blank rests on the bolts themselves, not on the edges of the holes. Every OD in
the table below is that rule, and matches the shop's numbers exactly.

| NPS | Bolt circle | Bolts | Disc OD | Overall length | Stem | Crossbar | Bar depth | Tag hole |
|---|---|---|---|---|---|---|---|---|
| 1-1/2" | 3.875 | 4 x 1/2" | **3-3/8  *** | 4.000 | 1.25 | 3.75 | 1.00 | 0.500 |
| 2" | 4.750 | 4 x 5/8" | **4-1/8** | 4.500 | 1.25 | 3.75 | 1.00 | 0.500 |
| 3" | 6.000 | 4 x 5/8" | **5-3/8** | 5.250 | 1.50 | 4.50 | 1.25 | 0.500 |
| 4" | 7.500 | 8 x 5/8" | **6-7/8** | 6.000 | 1.50 | 4.50 | 1.25 | 0.500 |
| 6" | 9.500 | 8 x 3/4" | **8-3/4** | 7.250 | 2.00 | 6.00 | 1.50 | 0.625 |
| 8" | 11.750 | 8 x 3/4" | **11** | 8.500 | 2.00 | 6.00 | 1.50 | 0.625 |
| 10" | 14.250 | 12 x 7/8" | **13-3/8** | 10.000 | 2.50 | 7.50 | 1.75 | 0.750 |

**\* The 1-1/2" is cut two ways.** The stated OD was 4-1/8, but that is the 2"
figure — a 4-1/8 disc will not enter a 1-1/2" Class 150 flange, whose bolts
leave 3-3/8 clear. Both files are provided:

| File | Disc OD | Note |
|---|---|---|
| `NPS1.5_CL150_skillet_per-rule.dxf` | 3-3/8 | Follows the rule, drops into a 1-1/2" flange |
| `NPS1.5_CL150_skillet_as-specified.dxf` | 4-1/8 | Exactly as stated. Will **not** fit a 1-1/2" flange |

## T-handle dimensions are DEFAULTS

The handle numbers in the table above are placeholders chosen to be
proportional, **not** shop-confirmed. Stem, crossbar length, crossbar depth and
projection past the flange OD all live in the `HANDLE` dict at the top of
`generate_skillet_blinds.py` — edit and re-run to change them. The disc ODs are
confirmed; only the handle is provisional.

## Before you cut

- **Units are inches.** Header set to imperial.
- **Geometry is nominal** — no kerf compensation applied.
- **Two layers.** `CUT` is profile and holes. `ETCH` is part-ID text only; send
  it to a marking op or delete the layer. Do not cut it.
- **LINE / ARC / CIRCLE only**, AutoCAD R12 (AC1009). No splines or polylines.
  Every profile verified as a closed contour with no degenerate entities.
- Stem meets the disc through a filleted root, and the two corners under the
  crossbar are filleted, so there is no sharp notch to start a crack when
  somebody levers on the handle.

## Plate thickness

See the thickness table in `../README.md` — same basis (ASME B31.3 §304.5.3),
and it is driven by the gasket ID, so it does not change with the disc OD used
here. Confirm design pressure and temperature before committing plate.

## Regenerating

```bash
python3 generate_skillet_blinds.py [output_dir]
```

Plain Python 3, no dependencies. `FLANGE` holds the B16.5 Class 150 data that
drives the ODs; `HANDLE` holds the T-handle dimensions.
