# Skillet Blinds — T handle, Class 150

Flat-pattern DXF cutting profiles for T-handle skillet blinds (line blanks) in
2", 3", 4", 6", 8" and 10", for ASME B16.5 Class 150 flanges.

## The two shop rules these are built on

**1. Disc OD = bolt circle diameter − bolt diameter.**
The blank seats against the *inside of the bolt shanks*, so the bolts capture
and centre it. That is bolt **diameter**, not bolt **hole** diameter — the blank
rests on the bolts themselves, not the edges of the holes.

**2. The crossbar starts 2" past the edge of the flange.**
The stem runs from the disc out past the flange edge, then a further 2" of bare
stem, and only then does the T begin. The whole crossbar sits clear of the
flange with room to get a hand on it with the joint bolted up.

| NPS | Disc OD | Flange r | Crossbar starts | Total length | Stem | Crossbar | Bar depth |
|---|---|---|---|---|---|---|---|
| 2" | **4-1/8** | 3.000 | 5.000 | 8.062 | 1.250 | 4.00 | 1.00 |
| 3" | **5-3/8** | 3.750 | 5.750 | 9.688 | 1.500 | 4.50 | 1.25 |
| 4" | **6-7/8** | 4.500 | 6.500 | 11.188 | 1.375 | 4.50 | 1.25 |
| 6" | **8-3/4** | 5.500 | 7.500 | 13.375 | 2.000 | 6.00 | 1.50 |
| 8" | **11** | 6.750 | 8.750 | 15.750 | 2.000 | 6.00 | 1.50 |
| 10" | **13-3/8** | 8.000 | 10.000 | 18.438 | 2.000 | 7.00 | 1.75 |

## Bolt clearance — the stem passes BETWEEN the bolts

No bolt passes through the handle. The stem is installed **centred between two
adjacent bolts** and is sized to clear the bolt shanks on both sides. Every size
holds at least 3/8" per side:

| NPS | Bolts | Bolt pitch offset | Stem | Clear to bolt, per side | Widest stem allowed |
|---|---|---|---|---|---|
| 2" | 4 x 5/8" | 1.679 | 1.250 | **0.742** | 1.984 |
| 3" | 4 x 5/8" | 2.121 | 1.500 | **1.059** | 2.868 |
| 4" | 8 x 5/8" | 1.435 | 1.375 | **0.435** | 1.495 |
| 6" | 8 x 3/4" | 1.818 | 2.000 | **0.443** | 2.135 |
| 8" | 8 x 3/4" | 2.248 | 2.000 | **0.873** | 2.997 |
| 10" | 12 x 7/8" | 1.844 | 2.000 | **0.407** | 2.063 |


*Bolt pitch offset* is the perpendicular distance from the stem centreline to
the nearest bolt centre, `(BC/2) x sin(pi/n)`. Clearance is that, less the bolt
radius, less half the stem width.

The generator **refuses to build** a stem that violates this — widen one past
the limit in the last column and it raises rather than emitting a part that
fouls a bolt. That check is in `bolt_clearance()` / `check_stem()`.

### Installing

Orient the blank so the stem comes out through a **bolt gap**, not over a bolt.
On the 4-bolt sizes (2" and 3") that means the handle exits at 45° to the bolt
pairs; on the 8- and 12-bolt sizes there are more gaps to choose from.

## Before you cut

- **Units are inches.** Header set to imperial.
- **Geometry is nominal** — no kerf compensation applied.
- **Two layers.** `CUT` is profile and holes. `ETCH` is part-ID text only; send
  it to a marking op or delete the layer. Do not cut it.
- **LINE / ARC / CIRCLE only**, AutoCAD R12 (AC1009). No splines or polylines.
  Every profile verified as a closed contour with no degenerate entities.
- Stem meets the disc through a filleted root, and the two corners under the
  crossbar are filleted, so there is no sharp notch to start a crack when
  somebody levers on the handle.

## Plate thickness

See the thickness table in `../README.md` — same basis (ASME B31.3 §304.5.3),
driven by the gasket ID, so it does not change with the disc OD used here.
Confirm design pressure and temperature before committing plate.

## Regenerating

```bash
python3 generate_skillet_blinds.py [output_dir]
```

Plain Python 3, no dependencies.

- `FLANGE` — B16.5 Class 150 data driving disc OD and handle reach
- `HANDLE` — stem width, crossbar length, crossbar depth, tag hole
- `FLANGE_GAP` — bare stem past the flange edge before the crossbar (2.00")
- `MIN_BOLT_CLEAR` — minimum stem-to-bolt gap per side (0.375")
