# Skillet Blinds — T handle, Class 600

Flat-pattern DXF cutting profiles for T-handle skillet blinds (line blanks),
ASME B16.5 Class 600 flanges. **Plain skillets — no hole in the handle.**

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
| 2" | **4-1/4** | 3/8" | 3.250 | 5.250 | 8.375 | 0.875 | 4.00 | 1.00 |

Plate thickness is the manufacturer chart value.

## Bolt clearance — the stem passes BETWEEN the bolts

No bolt passes through the handle. The stem is installed **centred between two
adjacent bolts** and clears the bolt shanks on both sides.

| NPS | Bolts | Bolt circle | Bolt hole | Stem | Clear to bolt, per side | Widest stem allowed |
|---|---|---|---|---|---|---|
| 2" | 8 x 5/8" | 5.00 | 0.750 | 0.875 | **0.207** | 1.038 |

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
