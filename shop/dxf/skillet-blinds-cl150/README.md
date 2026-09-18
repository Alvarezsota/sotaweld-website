# Skillet Blinds — T handle, Class 150

Every ASME B16.5 size in Class 150. **Plain skillets — no hole in the handle.**

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
| 1/2 | **1-3/4** | 1/8" | 4 x 1/2" | 2-3/8 | 0.152 | 5.625 | 0 |
| 3/4 | **2-1/8** | 1/8" | 4 x 1/2" | 2-3/4 | 0.285 | 6.003 | 0 |
| 1 | **2-1/2** | 1/8" | 4 x 1/2" | 3-1/8 | 0.417 | 6.375 | 0 |
| 1-1/4 | **2-7/8** | 1/4" | 4 x 1/2" | 3-1/2 | 0.550 | 6.747 | 1 |
| 1-1/2 | **3-1/4** | 1/4" | 4 x 1/2" | 3-7/8 | 0.683 | 7.125 | 1 |
| 2 | **4** | 1/4" | 4 x 5/8" | 4-3/4 | 0.929 | 8.000 | 1 |
| 2-1/2 | **4-3/4** | 1/4" | 4 x 5/8" | 5-1/2 | 1.195 | 8.875 | 2 |
| 3 | **5-1/4** | 1/4" | 4 x 5/8" | 6 | 1.371 | 9.375 | 2 |
| 3-1/2 | **6-1/4** | 3/8" | 8 x 5/8" | 7 | 0.589 | 10.375 | 4 |
| 4 | **6-3/4** | 3/8" | 8 x 5/8" | 7-1/2 | 0.685 | 10.875 | 4 |
| 5 | **7-5/8** | 3/8" | 8 x 3/4" | 8-1/2 | 0.814 | 11.812 | 5 |
| 6 | **8-5/8** | 1/2" | 8 x 3/4" | 9-1/2 | 1.005 | 12.812 | 9 |
| 8 | **10-7/8** | 1/2" | 8 x 3/4" | 11-3/4 | 1.436 | 15.188 | 14 |
| 10 | **13-1/4** | 5/8" | 12 x 7/8" | 14-1/4 | 0.969 | 17.625 | 25 |
| 12 | **16** | 3/4" | 12 x 7/8" | 17 | 1.325 | 20.500 | 44 |
| 14 | **17-5/8** | 3/4" | 12 x 1" | 18-3/4 | 1.489 | 22.312 | 53 |
| 16 | **20-1/8** | 7/8" | 16 x 1" | 21-1/4 | 1.135 | 24.812 | 80 |
| 18 | **21-1/2** | 1" | 16 x 1-1/8" | 22-3/4 | 1.219 | 26.250 | 105 |
| 20 | **23-3/4** | 1-1/8" | 20 x 1-1/8" | 25 | 0.955 | 28.625 | 143 |
| 24 | **28-1/8** | 1-1/4" | 20 x 1-1/4" | 29-1/2 | 1.245 | 33.062 | 223 |

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
