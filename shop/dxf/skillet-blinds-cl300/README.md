# Skillet Blinds — T handle, Class 300

Every ASME B16.5 size in Class 300. **Plain skillets — no hole in the handle.**

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
| 1/2 | **2** | 1/4" | 4 x 1/2" | 3 x 1 | 0.241 | 5.875 | 1 |
| 3/4 | **2-1/2** | 1/4" | 4 x 5/8" | 3 x 1 | 0.399 | 6.560 | 1 |
| 1 | **2-3/4** | 1/4" | 4 x 5/8" | 3 x 1 | 0.487 | 6.815 | 1 |
| 1-1/4 | **3-1/8** | 1/4" | 4 x 5/8" | 3 x 1 | 0.620 | 7.188 | 1 |
| 1-1/2 | **3-5/8** | 1/4" | 4 x 3/4" | 3 x 1 | 0.778 | 7.872 | 1 |
| 2 | **4-1/4** | 3/8" | 8 x 5/8" | 3 x 1 | 0.207 | 8.375 | 2 |
| 2-1/2 | **5** | 3/8" | 8 x 3/4" | 3 x 1 | 0.312 | 9.250 | 3 |
| 3 | **5-3/4** | 3/8" | 8 x 3/4" | 3 x 1 | 0.455 | 10.000 | 3 |
| 3-1/2 | **6-3/8** | 1/2" | 8 x 3/4" | 3 x 1 | 0.575 | 10.688 | 5 |
| 4 | **7** | 1/2" | 8 x 3/4" | 3 x 1 | 0.694 | 11.500 | 6 |
| 5 | **8-3/8** | 5/8" | 8 x 3/4" | 3 x 1 | 0.957 | 12.688 | 11 |
| 6 | **9-3/4** | 5/8" | 12 x 3/4" | 3 x 1 | 0.562 | 14.125 | 14 |
| 8 | **12** | 7/8" | 12 x 7/8" | 3 x 1 | 0.807 | 16.500 | 30 |
| 10 | **14-1/8** | 1" | 16 x 1" | 3 x 1 | 0.550 | 18.812 | 46 |
| 12 | **16-1/2** | 1-1/8" | 16 x 1-1/8" | 4 x 1-1/4 **↑** | 0.731 | 21.750 | 71 |
| 14 | **19** | 1-1/4" | 20 x 1-1/8" | 4 x 1-1/4 **↑** | 0.584 | 24.250 | 104 |
| 16 | **21-1/8** | 1-1/2" | 20 x 1-1/4" | 4 x 1-1/4 **↑** | 0.697 | 26.562 | 153 |
| 18 | **23-3/8** | 1-5/8" | 24 x 1-1/4" | 4 x 1-1/4 **↑** | 0.553 | 28.938 | 202 |
| 20 | **25-5/8** | 1-3/4" | 24 x 1-1/4" | 4 x 1-1/4 **↑** | 0.700 | 31.312 | 260 |
| 24 | **30-3/8** | 2" | 24 x 1-1/2" | 4 x 1-1/4 **↑** | 0.901 | 36.438 | 416 |

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
