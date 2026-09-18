# Skillet Blinds — T handle, Class 600

Every ASME B16.5 size in Class 600. **Plain skillets — no hole in the handle.**

## Where the numbers come from

| Dimension | Source |
|---|---|
| Disc OD, bolt circle, bore, plate thickness | **Manufacturer table** (shop supplied) |
| Bolt diameter | **Derived** as `bolt circle − disc OD − 1/8"`, cross-checked against B16.5 |
| Flange OD, bolt count | **ASME B16.5** — not in the manufacturer table, see caveat below |

Disc OD is `bolt circle − bolt HOLE diameter`, which leaves 1/16" radial to the
bolt shanks so the blank drops in instead of sitting dead tangent. Every OD is
asserted against the manufacturer table at build time; a mismatch fails the
build rather than cutting a wrong part.

> **Caveat.** Flange OD and bolt count are from my ASME B16.5 tables, not from
> your manufacturer sheet, because that sheet does not carry them. Bolt count
> sets the stem width and flange OD sets the handle length, so if a size looks
> off, those two are where to check first. Bolt *diameter* is verified against
> your data on all 79 sizes and matches exactly.

## Handle

The crossbar **starts 2" past the flange edge** — stem out past the flange, then
2" of bare stem, then the T. Stem is sized to the part (about 30% of disc OD)
and then capped by the bolts, aiming for 0.1875" clearance to the shanks and never
going below 0.125".

| NPS | Disc OD | Plate | Bolts | Stem | Crossbar | Bar depth | Bolt gap/side | Overall L | Approx lb |
|---|---|---|---|---|---|---|---|---|---|
| 1/2 | **2** | 1/4" | 4 x 1/2" | 5/8 | 2-1/2 | 3/4 | 0.366 | 5.625 | 0 |
| 3/4 | **2-1/2** | 1/4" | 4 x 5/8" | 3/4 | 2-1/2 | 3/4 | 0.462 | 6.310 | 1 |
| 1 | **2-3/4** | 1/4" | 4 x 5/8" | 3/4 | 2-1/2 | 3/4 | 0.550 | 6.565 | 1 |
| 1-1/4 | **3-1/8** | 3/8" | 4 x 5/8" | 7/8 | 2-1/2 | 3/4 | 0.620 | 6.938 | 1 |
| 1-1/2 | **3-5/8** | 3/8" | 4 x 3/4" | 1 | 2-3/4 | 3/4 | 0.716 | 7.622 | 2 |
| 2 | **4-1/4** | 3/8" | 8 x 5/8" | 7/8 | 2-1/2 | 3/4 | 0.207 | 8.125 | 2 |
| 2-1/2 | **5** | 1/2" | 8 x 3/4" | 1 | 2-3/4 | 3/4 | 0.249 | 9.000 | 4 |
| 3 | **5-3/4** | 1/2" | 8 x 3/4" | 1-3/8 | 3-3/4 | 1 | 0.205 | 10.000 | 5 |
| 3-1/2 | **6-1/4** | 5/8" | 8 x 7/8" | 1-1/2 | 4 | 1-1/8 | 0.200 | 10.750 | 7 |
| 4 | **7-1/2** | 5/8" | 8 x 7/8" | 2 | 5-1/2 | 1-1/2 | 0.189 | 12.625 | 11 |
| 5 | **9-3/8** | 3/4" | 8 x 1" | 2-5/8 | 7-1/4 | 2 | 0.197 | 15.188 | 20 |
| 6 | **10-3/8** | 7/8" | 12 x 1" | 1-1/2 | 4 | 1-1/8 | 0.238 | 15.312 | 24 |
| 8 | **12-1/2** | 1-1/8" | 12 x 1-1/8" | 2 | 5-1/2 | 1-1/2 | 0.217 | 18.000 | 44 |
| 10 | **15-5/8** | 1-3/8" | 16 x 1-1/4" | 1-5/8 | 4-1/2 | 1-1/4 | 0.221 | 21.062 | 80 |
| 12 | **17-7/8** | 1-5/8" | 20 x 1-1/4" | 1-3/8 | 3-3/4 | 1 | 0.193 | 22.938 | 120 |
| 14 | **19-1/4** | 1-3/4" | 20 x 1-3/8" | 1-3/8 | 3-3/4 | 1 | 0.248 | 24.500 | 149 |
| 16 | **22-1/8** | 2" | 20 x 1-1/2" | 1-3/4 | 4-3/4 | 1-1/4 | 0.233 | 27.812 | 226 |
| 18 | **24** | 2-1/8" | 20 x 1-5/8" | 2 | 5-1/2 | 1-1/2 | 0.202 | 30.125 | 283 |
| 20 | **26-3/4** | 2-1/2" | 24 x 1-5/8" | 1-5/8 | 4-1/2 | 1-1/4 | 0.235 | 32.625 | 408 |
| 24 | **31** | 2-7/8" | 24 x 1-7/8" | 2 | 5-1/2 | 1-1/2 | 0.216 | 37.500 | 630 |

## The stem passes BETWEEN the bolts

No bolt passes through the handle. Install the blank with the stem **centred
between two adjacent bolts** — on 4-bolt sizes that means the handle exits at
45° to the bolt pairs. The generator refuses to build a stem that would foul a
bolt.

## ⚠ Weight

The `Approx lb` column is bare steel at 0.2836 lb/in³. Anything over about 50 lb
is rigging, not hand-carrying — **the T handle is for positioning and
identification, not a lifting point.** The largest parts in this class run into
the hundreds of pounds.

## Before you cut

- **Units are inches.** Geometry is nominal — apply kerf compensation in CAM.
- **Two layers.** `CUT` is the profile. `ETCH` is part-ID text only; send it to
  a marking op or delete the layer. Do not cut it.
- **LINE / ARC only**, AutoCAD R12. Every profile verified as a closed contour
  with no degenerate entities and no holes.
- Filleted stem root and filleted corners under the crossbar.

## Regenerating

```bash
python3 ../generate_all_skillets.py [output_dir]
```

No dependencies. Data lives in `../blank_data.py`: `MANUFACTURER` is your table
verbatim, `B16_5` is flange OD and bolt count. `../skillet-blind-index.csv` is
every part in all four classes on one sheet.
