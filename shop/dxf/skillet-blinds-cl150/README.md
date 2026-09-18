# Skillet Blinds — T handle, Class 150

Every ASME B16.5 size in Class 150. **Plain skillets — no hole in the handle.**

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
| 1/2 | **1-3/4** | 1/8" | 4 x 1/2" | 5/8 | 2-1/2 | 3/4 | 0.277 | 5.375 | 0 |
| 3/4 | **2-1/8** | 1/8" | 4 x 1/2" | 5/8 | 2-1/2 | 3/4 | 0.410 | 5.753 | 0 |
| 1 | **2-1/2** | 1/8" | 4 x 1/2" | 3/4 | 2-1/2 | 3/4 | 0.480 | 6.125 | 0 |
| 1-1/4 | **2-7/8** | 1/4" | 4 x 1/2" | 3/4 | 2-1/2 | 3/4 | 0.612 | 6.497 | 1 |
| 1-1/2 | **3-1/4** | 1/4" | 4 x 1/2" | 7/8 | 2-1/2 | 3/4 | 0.683 | 6.875 | 1 |
| 2 | **4** | 1/4" | 4 x 5/8" | 1-1/8 | 3 | 7/8 | 0.804 | 7.875 | 1 |
| 2-1/2 | **4-3/4** | 1/4" | 4 x 5/8" | 1-3/8 | 3-3/4 | 1 | 0.945 | 8.875 | 2 |
| 3 | **5-1/4** | 1/4" | 4 x 5/8" | 1-1/2 | 4 | 1-1/8 | 1.059 | 9.500 | 2 |
| 3-1/2 | **6-1/4** | 3/8" | 8 x 5/8" | 1-5/8 | 4-1/2 | 1-1/4 | 0.214 | 10.625 | 4 |
| 4 | **6-3/4** | 3/8" | 8 x 5/8" | 1-3/4 | 4-3/4 | 1-1/4 | 0.248 | 11.125 | 5 |
| 5 | **7-5/8** | 3/8" | 8 x 3/4" | 2-1/8 | 5-3/4 | 1-5/8 | 0.189 | 12.438 | 7 |
| 6 | **8-5/8** | 1/2" | 8 x 3/4" | 2-1/2 | 7 | 1-7/8 | 0.193 | 13.688 | 11 |
| 8 | **10-7/8** | 1/2" | 8 x 3/4" | 3 | 8-1/4 | 2 | 0.373 | 16.188 | 17 |
| 10 | **13-1/4** | 5/8" | 12 x 7/8" | 2-3/8 | 6-1/2 | 1-3/4 | 0.219 | 18.375 | 28 |
| 12 | **16** | 3/4" | 12 x 7/8" | 3 | 8-1/4 | 2 | 0.262 | 21.500 | 49 |
| 14 | **17-5/8** | 3/4" | 12 x 1" | 3 | 8-1/4 | 2 | 0.426 | 23.312 | 58 |
| 16 | **20-1/8** | 7/8" | 16 x 1" | 2-3/4 | 7-1/2 | 2 | 0.198 | 25.812 | 85 |
| 18 | **21-1/2** | 1" | 16 x 1-1/8" | 2-7/8 | 8 | 2 | 0.219 | 27.250 | 111 |
| 20 | **23-3/4** | 1-1/8" | 20 x 1-1/8" | 2-3/8 | 6-1/2 | 1-3/4 | 0.205 | 29.375 | 148 |
| 24 | **28-1/8** | 1-1/4" | 20 x 1-1/4" | 2-7/8 | 8 | 2 | 0.245 | 34.062 | 230 |

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
