# Skillet Blinds — T handle, Class 900

Every ASME B16.5 size in Class 900. **Plain skillets — no hole in the handle.**

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
| 1/2 | **2-3/8** | 1/4" | 4 x 3/4" | 5/8 | 2-1/2 | 3/4 | 0.462 | 6.312 | 1 |
| 3/4 | **2-5/8** | 1/4" | 4 x 3/4" | 3/4 | 2-1/2 | 3/4 | 0.487 | 6.622 | 1 |
| 1 | **3** | 1/4" | 4 x 7/8" | 7/8 | 2-1/2 | 3/4 | 0.539 | 7.190 | 1 |
| 1-1/4 | **3-3/8** | 3/8" | 4 x 7/8" | 1 | 2-3/4 | 3/4 | 0.609 | 7.562 | 2 |
| 1-1/2 | **3-3/4** | 3/8" | 4 x 1" | 1-1/8 | 3 | 7/8 | 0.661 | 8.250 | 2 |
| 2 | **5-1/2** | 1/2" | 8 x 7/8" | 1-1/8 | 3 | 7/8 | 0.244 | 9.875 | 4 |
| 2-1/2 | **6-3/8** | 1/2" | 8 x 1" | 1-3/8 | 3-3/4 | 1 | 0.248 | 10.997 | 6 |
| 3 | **6-1/2** | 5/8" | 8 x 7/8" | 1-1/2 | 4 | 1-1/8 | 0.248 | 11.125 | 8 |
| 4 | **8** | 3/4" | 8 x 1-1/8" | 2 | 5-1/2 | 1-1/2 | 0.207 | 13.250 | 14 |
| 5 | **9-5/8** | 7/8" | 8 x 1-1/4" | 2-1/2 | 7 | 1-7/8 | 0.230 | 15.562 | 24 |
| 6 | **11-1/4** | 1" | 12 x 1-1/8" | 1-5/8 | 4-1/2 | 1-1/4 | 0.243 | 16.375 | 32 |
| 8 | **14** | 1-3/8" | 12 x 1-3/8" | 2-1/4 | 6-1/4 | 1-3/4 | 0.193 | 20.000 | 68 |
| 10 | **17** | 1-5/8" | 16 x 1-3/8" | 1-3/4 | 4-3/4 | 1-1/4 | 0.242 | 22.500 | 111 |
| 12 | **19-1/2** | 1-7/8" | 20 x 1-3/8" | 1-1/2 | 4 | 1-1/8 | 0.205 | 24.875 | 165 |
| 14 | **20-3/8** | 2-1/8" | 20 x 1-1/2" | 1-1/2 | 4 | 1-1/8 | 0.221 | 25.938 | 203 |
| 16 | **22-1/2** | 2-3/8" | 20 x 1-5/8" | 1-3/4 | 4-3/4 | 1-1/4 | 0.209 | 28.375 | 277 |
| 18 | **25** | 2-5/8" | 20 x 1-7/8" | 1-7/8 | 5-1/4 | 1-3/8 | 0.237 | 31.375 | 378 |
| 20 | **27-3/8** | 2-7/8" | 20 x 2" | 2-1/8 | 5-3/4 | 1-5/8 | 0.245 | 34.188 | 496 |
| 24 | **32-7/8** | 3-1/2" | 20 x 2-1/2" | 2-5/8 | 7-1/4 | 2 | 0.214 | 40.938 | 873 |

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
