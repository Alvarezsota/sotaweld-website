# Skillet Blinds — T handle, Class 900

Every ASME B16.5 size in Class 900. **Plain skillets — no hole in the handle.**

## Handle

| | |
|---|---|
| Stem width | **7/8"** — every size, every class |
| Knob under 12" | **3"** long x **1"** deep |
| Knob 12" and up | **4"** long x **1-1/4"** deep (marked **↑** below) |
| Reach | knob starts **2" past the flange edge** |
| Fillets | 3/16" stem root and under-knob corners, 1/4" knob corners |

One stem carries the whole library. It is capped by the tightest flange in it —
the **1/2" Class 150**, four 1/2" bolts on a 2-3/8" bolt circle, allowing
0.929". 7/8" is the widest 1/8" step that fits there and it clears every other
size in every class. The build re-proves that limit from the data and **fails**
if it ever stops holding.

The knob steps up at 12" NPS, where the blanks get heavy enough to want a better
grip. **Only the knob changes** — the knob sits 2" clear of the flange, so
nothing about this touches bolt clearance. Handles also keep growing with the
flange because reach is measured from the flange edge, not the disc.

## Where the numbers come from

| Dimension | Source |
|---|---|
| Disc OD, bolt circle, bore, plate thickness | **Manufacturer table** (shop supplied) |
| Bolt diameter | **Derived** as `bolt circle − disc OD − 1/8"`, cross-checked against B16.5 |
| Flange OD, bolt count | **ASME B16.5** — not in the manufacturer table |

Disc OD is `bolt circle − bolt HOLE diameter`, leaving 1/16" radial to the bolt
shanks so the blank drops in rather than sitting dead tangent. Every OD is
asserted against the manufacturer table at build time.

> **Caveat.** Flange OD and bolt count are from my ASME B16.5 tables, not the
> manufacturer sheet, which does not carry them. Bolt count sets the bolt gap
> and flange OD sets the handle length, so if a size looks wrong those are the
> two to check. Bolt *diameter* is verified against the shop data on all 112
> sizes and matches exactly.

| NPS | Disc OD | Plate | Bolts | Knob | Bolt gap/side | Overall L | Approx lb |
|---|---|---|---|---|---|---|---|
| 1/2 | **2-3/8** | 1/4" | 4 x 3/4" | 3 x 1 | 0.337 | 6.562 | 1 |
| 3/4 | **2-5/8** | 1/4" | 4 x 3/4" | 3 x 1 | 0.425 | 6.872 | 1 |
| 1 | **3** | 1/4" | 4 x 7/8" | 3 x 1 | 0.539 | 7.440 | 1 |
| 1-1/4 | **3-3/8** | 3/8" | 4 x 7/8" | 3 x 1 | 0.672 | 7.812 | 2 |
| 1-1/2 | **3-3/4** | 3/8" | 4 x 1" | 3 x 1 | 0.786 | 8.375 | 2 |
| 2 | **5-1/2** | 1/2" | 8 x 7/8" | 3 x 1 | 0.369 | 10.000 | 4 |
| 2-1/2 | **6-3/8** | 1/2" | 8 x 1" | 3 x 1 | 0.498 | 10.997 | 5 |
| 3 | **6-1/2** | 5/8" | 8 x 7/8" | 3 x 1 | 0.560 | 11.000 | 7 |
| 4 | **8** | 3/4" | 8 x 1-1/8" | 3 x 1 | 0.770 | 12.750 | 12 |
| 5 | **9-5/8** | 7/8" | 8 x 1-1/4" | 3 x 1 | 1.042 | 14.688 | 20 |
| 6 | **11-1/4** | 1" | 12 x 1-1/8" | 3 x 1 | 0.618 | 16.125 | 30 |
| 8 | **14** | 1-3/8" | 12 x 1-3/8" | 3 x 1 | 0.881 | 19.250 | 63 |
| 10 | **17** | 1-5/8" | 16 x 1-3/8" | 3 x 1 | 0.680 | 22.250 | 108 |
| 12 | **19-1/2** | 1-7/8" | 20 x 1-3/8" | 4 x 1-1/4 **↑** | 0.518 | 25.000 | 163 |
| 14 | **20-3/8** | 2-1/8" | 20 x 1-1/2" | 4 x 1-1/4 **↑** | 0.533 | 26.062 | 202 |
| 16 | **22-1/2** | 2-3/8" | 20 x 1-5/8" | 4 x 1-1/4 **↑** | 0.647 | 28.375 | 274 |
| 18 | **25** | 2-5/8" | 20 x 1-7/8" | 4 x 1-1/4 **↑** | 0.737 | 31.250 | 372 |
| 20 | **27-3/8** | 2-7/8" | 20 x 2" | 4 x 1-1/4 **↑** | 0.870 | 33.812 | 488 |
| 24 | **32-7/8** | 3-1/2" | 20 x 2-1/2" | 4 x 1-1/4 **↑** | 1.089 | 40.188 | 853 |

## The stem passes BETWEEN the bolts

No bolt passes through the handle. Install with the stem **centred between two
adjacent bolts** — on 4-bolt sizes the handle exits at 45° to the bolt pairs.

## ⚠ Weight

`Approx lb` is bare steel at 0.2836 lb/in³. **The T handle is for positioning and
identification, not lifting.** A bigger knob at 12" and up makes these easier to
handle and guide; it does not make them liftable. Rig the heavy ones.

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
`BAR_L`/`BAR_D`, `BAR_L_BIG`/`BAR_D_BIG` and `BIG_KNOB_FROM` constants at the
top of the generator. `../skillet-blind-index.csv` lists all 112 parts.
