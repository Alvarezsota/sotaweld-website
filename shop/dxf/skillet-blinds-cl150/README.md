# Skillet Blinds — T handle, Class 150

Flat-pattern DXF cutting profiles for T-handle skillet blinds (line blanks),
ASME B16.5 Class 150 flanges. **Plain skillets — no hole in the handle.**

## Disc OD — from the manufacturer chart

    disc OD = bolt circle diameter − bolt HOLE diameter

Bolt **hole**, not bolt diameter. That leaves 1/16" radial clearance to the bolt
shanks so the blank actually drops in, instead of sitting dead tangent to them.
Every OD here is asserted against the manufacturer's published chart at build
time — a mismatch fails the build rather than cutting a wrong part.

## Handle reach

    the crossbar STARTS 2" past the edge of the flange

Stem runs from the disc out past the flange edge, then a further 2" of bare
stem, and only then does the T begin — the whole crossbar sits clear with room
to get a hand on it with the joint bolted up.

| NPS | Disc OD | Plate | Flange r | Crossbar starts | Total length | Stem | Crossbar | Bar depth |
|---|---|---|---|---|---|---|---|---|
| 2" | **4** | 5/16" | 3.000 | 5.000 | 8.000 | 1.250 | 4.00 | 1.00 |
| 3" | **5-1/4** | 5/16" | 3.750 | 5.750 | 9.625 | 1.500 | 4.50 | 1.25 |
| 4" | **6-3/4** | 3/8" | 4.500 | 6.500 | 11.125 | 1.375 | 4.50 | 1.25 |
| 6" | **8-5/8** | 1/2" | 5.500 | 7.500 | 13.312 | 2.000 | 6.00 | 1.50 |
| 8" | **10-7/8** | 1/2" | 6.750 | 8.750 | 15.688 | 2.000 | 6.00 | 1.50 |
| 10" | **13-1/4** | 5/8" | 8.000 | 10.000 | 18.375 | 2.000 | 7.00 | 1.75 |

Plate thickness is the manufacturer chart value.

## Bolt clearance — the stem passes BETWEEN the bolts

No bolt passes through the handle. The stem is installed **centred between two
adjacent bolts** and clears the bolt shanks on both sides.

| NPS | Bolts | Bolt circle | Bolt hole | Stem | Clear to bolt, per side | Widest stem allowed |
|---|---|---|---|---|---|---|
| 2" | 4 x 5/8" | 4.75 | 0.750 | 1.250 | **0.742** | 2.484 |
| 3" | 4 x 5/8" | 6.00 | 0.750 | 1.500 | **1.059** | 3.368 |
| 4" | 8 x 5/8" | 7.50 | 0.750 | 1.375 | **0.435** | 1.995 |
| 6" | 8 x 3/4" | 9.50 | 0.875 | 2.000 | **0.443** | 2.635 |
| 8" | 8 x 3/4" | 11.75 | 0.875 | 2.000 | **0.873** | 3.497 |
| 10" | 12 x 7/8" | 14.25 | 1.000 | 2.000 | **0.407** | 2.563 |

The generator **refuses to build** a stem that violates this — widen one past
the limit in the last column and it raises rather than emitting a part that
fouls a bolt.

### Installing

Orient the blank so the stem comes out through a **bolt gap**, not over a bolt.
On 4-bolt sizes the handle exits at 45° to the bolt pairs.

## Before you cut

- **Units are inches.** Geometry is nominal — no kerf compensation applied.
- **Two layers.** `CUT` is the profile. `ETCH` is part-ID text only; send it to
  a marking op or delete the layer. Do not cut it.
- **LINE / ARC only**, AutoCAD R12. Every profile verified as a closed contour.
- Filleted stem root and filleted corners under the crossbar.

## Regenerating

```bash
python3 ../generate_skillet_blinds.py [output_dir]
```

No dependencies. `FLANGE` and `HANDLE` are keyed `(class, NPS)`; `CHART` is the
manufacturer's published OD and thickness and is the authority; `FLANGE_GAP` is
the bare stem past the flange edge; `MIN_BOLT_CLEAR` is the stem-to-bolt floor.
