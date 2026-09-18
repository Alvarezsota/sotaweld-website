# Skillet Blinds — T handle, Class 2500

Every ASME B16.5 size in Class 2500. **Plain skillets — no hole in the handle.**

## One handle, every size and class

| | |
|---|---|
| Stem width | **7/8"** |
| Crossbar | **3"** long x **1"** deep |
| Reach | crossbar starts **2" past the flange edge** |
| Fillets | 3/16" stem root and under-bar corners, 1/4" bar corners |

The stem is capped by the tightest flange in the whole library — the **1/2"
Class 150**, four 1/2" bolts on a 2-3/8" bolt circle, which allows 0.929".
7/8" is the widest 1/8" step that fits there, and it clears every other size
in every class. The build re-proves this and **fails** if it ever stops holding.

Because reach is measured from the flange edge, the handle still grows with the
flange even though the stem does not — total length runs from 5.62" on the 1/2"
150 to 43.69" on the 24" 1500.

## Where the numbers come from

| Dimension | Source |
|---|---|
| Disc OD, bolt circle, bore, plate thickness | **Manufacturer table** (shop supplied) |
| Bolt diameter | **Derived** as `bolt circle − disc OD − 1/8"`, cross-checked against B16.5 |
| Flange OD, bolt count | **ASME B16.5** — not in the manufacturer table |

Disc OD is `bolt circle − bolt HOLE diameter`, leaving 1/16" radial to the bolt
shanks so the blank drops in rather than sitting dead tangent. Every OD is
asserted against the manufacturer table at build time.

> **Caveat.** Flange OD and bolt count are from my ASME B16.5 tables, not your
> manufacturer sheet, which does not carry them. Bolt count sets the bolt gap
> and flange OD sets the handle length, so if a size looks wrong those are the
> two to check. Bolt *diameter* is verified against your data on all 112 sizes
> and matches exactly.

| NPS | Disc OD | Plate | Bolts | Bolt circle | Bolt gap/side | Overall L | Approx lb |
|---|---|---|---|---|---|---|---|
| 1/2 | **2-5/8** | 3/8" | 4 x 3/4" | 3-1/2 | 0.425 | 6.938 | 1 |
| 3/4 | **2-7/8** | 3/8" | 4 x 3/4" | 3-3/4 | 0.513 | 7.188 | 1 |
| 1 | **3-1/4** | 3/8" | 4 x 7/8" | 4-1/4 | 0.628 | 7.750 | 2 |
| 1-1/4 | **4** | 1/2" | 4 x 1" | 5-1/8 | 0.874 | 8.625 | 3 |
| 1-1/2 | **4-1/2** | 5/8" | 4 x 1-1/8" | 5-3/4 | 1.033 | 9.250 | 4 |
| 2 | **5-5/8** | 5/8" | 8 x 1" | 6-3/4 | 0.354 | 10.438 | 6 |
| 2-1/2 | **6-1/2** | 3/4" | 8 x 1-1/8" | 7-3/4 | 0.483 | 11.500 | 8 |
| 3 | **7-5/8** | 7/8" | 8 x 1-1/4" | 9 | 0.660 | 12.812 | 13 |
| 4 | **9-1/8** | 1-1/8" | 8 x 1-1/2" | 10-3/4 | 0.869 | 14.562 | 23 |
| 5 | **10-7/8** | 1-3/8" | 8 x 1-3/4" | 12-3/4 | 1.127 | 16.688 | 39 |
| 6 | **12-3/8** | 1-5/8" | 8 x 2" | 14-1/2 | 1.337 | 18.688 | 59 |
| 8 | **15-1/8** | 2-1/8" | 12 x 2" | 17-1/4 | 0.795 | 21.438 | 113 |
| 10 | **18-5/8** | 2-5/8" | 12 x 2-1/2" | 21-1/4 | 1.062 | 25.562 | 209 |
| 12 | **21-1/2** | 3-1/8" | 12 x 2-3/4" | 24-3/8 | 1.342 | 28.750 | 329 |

## The stem passes BETWEEN the bolts

No bolt passes through the handle. Install with the stem **centred between two
adjacent bolts** — on 4-bolt sizes the handle exits at 45° to the bolt pairs.

## ⚠ Weight

`Approx lb` is bare steel at 0.2836 lb/in³. **The T handle is for positioning and
identification, not lifting.** One 7/8" stem carries every size in this library,
so on the large high-class blanks it is a token handle on a part weighing
hundreds of pounds — rig those, do not carry them.

## Before you cut

- **Units are inches.** Geometry is nominal — apply kerf compensation in CAM.
- **Two layers.** `CUT` is the profile. `ETCH` is part-ID text only; send it to
  a marking op or delete the layer. Do not cut it.
- **LINE / ARC only**, AutoCAD R12. Every profile verified as a closed contour,
  no degenerate entities, no holes.

## Regenerating

```bash
python3 ../generate_all_skillets.py [output_dir]
```

No dependencies. Data is in `../blank_data.py`. Handle geometry is the `STEM`,
`BAR_L`, `BAR_D` constants at the top of the generator — change one and every
class regenerates together. `../skillet-blind-index.csv` lists all 112 parts.
