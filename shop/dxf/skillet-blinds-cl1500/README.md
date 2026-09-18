# Skillet Blinds — T handle, Class 1500

Every ASME B16.5 size in Class 1500. **Plain skillets — no hole in the handle.**

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
| 1/2 | **2-3/8** | 1/4" | 4 x 3/4" | 3-1/4 | 0.337 | 6.562 | 1 |
| 3/4 | **2-5/8** | 3/8" | 4 x 3/4" | 3-1/2 | 0.425 | 6.872 | 1 |
| 1 | **3** | 3/8" | 4 x 7/8" | 4 | 0.539 | 7.440 | 1 |
| 1-1/4 | **3-3/8** | 3/8" | 4 x 7/8" | 4-3/8 | 0.672 | 7.812 | 2 |
| 1-1/2 | **3-3/4** | 1/2" | 4 x 1" | 4-7/8 | 0.786 | 8.375 | 2 |
| 2 | **5-1/2** | 1/2" | 8 x 7/8" | 6-1/2 | 0.369 | 10.000 | 4 |
| 2-1/2 | **6-3/8** | 5/8" | 8 x 1" | 7-1/2 | 0.498 | 10.997 | 7 |
| 3 | **6-3/4** | 3/4" | 8 x 1-1/8" | 8 | 0.531 | 11.625 | 9 |
| 4 | **8-1/8** | 7/8" | 8 x 1-1/4" | 9-1/2 | 0.755 | 13.188 | 14 |
| 5 | **9-7/8** | 1-1/8" | 8 x 1-1/2" | 11-1/2 | 1.013 | 15.312 | 27 |
| 6 | **11** | 1-3/8" | 12 x 1-3/8" | 12-1/2 | 0.493 | 16.250 | 40 |
| 8 | **13-3/4** | 1-5/8" | 12 x 1-5/8" | 15-1/2 | 0.756 | 19.375 | 72 |
| 10 | **17** | 2" | 12 x 1-7/8" | 19 | 1.084 | 23.000 | 133 |
| 12 | **20-3/8** | 2-3/8" | 16 x 2" | 22-1/2 | 0.757 | 26.438 | 225 |
| 14 | **22-5/8** | 2-5/8" | 16 x 2-1/4" | 25 | 0.876 | 29.062 | 305 |
| 16 | **25-1/8** | 3" | 16 x 2-1/2" | 27-3/4 | 1.019 | 31.812 | 429 |
| 18 | **27-5/8** | 3-3/8" | 16 x 2-3/4" | 30-1/2 | 1.163 | 34.812 | 582 |
| 20 | **29-5/8** | 3-3/4" | 16 x 3" | 32-3/4 | 1.257 | 37.188 | 742 |
| 24 | **35-3/8** | 4-3/8" | 16 x 3-1/2" | 39 | 1.617 | 43.688 | 1231 |

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
