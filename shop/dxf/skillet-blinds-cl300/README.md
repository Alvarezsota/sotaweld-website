# Skillet Blinds — T handle, Class 300

Every ASME B16.5 size in Class 300. **Plain skillets — no hole in the handle.**

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
| 1/2 | **2** | 1/4" | 4 x 1/2" | 2-5/8 | 0.241 | 5.875 | 1 |
| 3/4 | **2-1/2** | 1/4" | 4 x 5/8" | 3-1/4 | 0.399 | 6.560 | 1 |
| 1 | **2-3/4** | 1/4" | 4 x 5/8" | 3-1/2 | 0.487 | 6.815 | 1 |
| 1-1/4 | **3-1/8** | 1/4" | 4 x 5/8" | 3-7/8 | 0.620 | 7.188 | 1 |
| 1-1/2 | **3-5/8** | 1/4" | 4 x 3/4" | 4-1/2 | 0.778 | 7.872 | 1 |
| 2 | **4-1/4** | 3/8" | 8 x 5/8" | 5 | 0.207 | 8.375 | 2 |
| 2-1/2 | **5** | 3/8" | 8 x 3/4" | 5-7/8 | 0.312 | 9.250 | 3 |
| 3 | **5-3/4** | 3/8" | 8 x 3/4" | 6-5/8 | 0.455 | 10.000 | 3 |
| 3-1/2 | **6-3/8** | 1/2" | 8 x 3/4" | 7-1/4 | 0.575 | 10.688 | 5 |
| 4 | **7** | 1/2" | 8 x 3/4" | 7-7/8 | 0.694 | 11.500 | 6 |
| 5 | **8-3/8** | 5/8" | 8 x 3/4" | 9-1/4 | 0.957 | 12.688 | 11 |
| 6 | **9-3/4** | 5/8" | 12 x 3/4" | 10-5/8 | 0.562 | 14.125 | 14 |
| 8 | **12** | 7/8" | 12 x 7/8" | 13 | 0.807 | 16.500 | 30 |
| 10 | **14-1/8** | 1" | 16 x 1" | 15-1/4 | 0.550 | 18.812 | 46 |
| 12 | **16-1/2** | 1-1/8" | 16 x 1-1/8" | 17-3/4 | 0.731 | 21.500 | 70 |
| 14 | **19** | 1-1/4" | 20 x 1-1/8" | 20-1/4 | 0.584 | 24.000 | 103 |
| 16 | **21-1/8** | 1-1/2" | 20 x 1-1/4" | 22-1/2 | 0.697 | 26.312 | 152 |
| 18 | **23-3/8** | 1-5/8" | 24 x 1-1/4" | 24-3/4 | 0.553 | 28.688 | 201 |
| 20 | **25-5/8** | 1-3/4" | 24 x 1-1/4" | 27 | 0.700 | 31.062 | 259 |
| 24 | **30-3/8** | 2" | 24 x 1-1/2" | 32 | 0.901 | 36.188 | 415 |

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
