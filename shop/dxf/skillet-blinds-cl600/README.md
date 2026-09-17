# Skillet Blinds — T handle, Class 600

Flat-pattern DXF cutting profiles for T-handle skillet blinds (line blanks),
for ASME B16.5 Class 600 flanges. **Plain skillets — no hole in the handle.**

## The two shop rules these are built on

**1. Disc OD = bolt circle diameter − bolt diameter.**
The blank seats against the *inside of the bolt shanks*, so the bolts capture
and centre it. That is bolt **diameter**, not bolt **hole** diameter.

**2. The crossbar starts 2" past the edge of the flange.**
The stem runs from the disc out past the flange edge, then a further 2" of bare
stem, and only then does the T begin — so the whole crossbar sits clear with
room to get a hand on it with the joint bolted up.

| NPS | Disc OD | Flange r | Crossbar starts | Total length | Stem | Crossbar | Bar depth | Plate |
|---|---|---|---|---|---|---|---|---|
| 2" | **4-1/4** † | 3.250 | 5.250 | 8.375 | 0.875 | 4.00 | 1.00 | 3/8" |

† **OD set from the shop's number, not the rule.** The rule would give 4.375, which sits dead tangent to the bolt shanks; 4.250 leaves 1/16" radial clearance. Worth confirming — either the 600s use a different rule than the 150s (4.250 is bolt circle minus bolt *hole* diameter), or the Class 600 bolt data here is wrong.

## Bolt clearance — the stem passes BETWEEN the bolts

No bolt passes through the handle. The stem is installed **centred between two
adjacent bolts** and is sized to clear the bolt shanks on both sides.

| NPS | Bolts | Bolt pitch offset | Stem | Clear to bolt, per side | Widest stem allowed |
|---|---|---|---|---|---|
| 2" | 8 x 5/8" | 0.957 | 0.875 | **0.207** | 1.038 |

*Bolt pitch offset* is the perpendicular distance from the stem centreline to
the nearest bolt centre, `(BC/2) x sin(pi/n)`. Clearance is that, less the bolt
radius, less half the stem width.

The generator **refuses to build** a stem that violates this — widen one past
the limit in the last column and it raises rather than emitting a part that
fouls a bolt.

### Installing

Orient the blank so the stem comes out through a **bolt gap**, not over a bolt.
On 4-bolt sizes the handle exits at 45° to the bolt pairs; 8- and 12-bolt sizes
give more choices.

## Plate thickness

Calculated per ASME B31.3 §304.5.3, `t = d_g x sqrt(3P / 16SE) + c`, at the
Class 600 cold rating of **1480 psi**, S = 20,000 psi (A516-70), E = 1.0, plus
1/16" corrosion allowance, rounded up to standard plate.

**A starting point, not a design.** It assumes ambient temperature and full
rating; Class 600 derates with temperature. Confirm actual design pressure,
temperature and material before committing plate. The DXFs are 2D, so thickness
does not affect the cut file.

## Before you cut

- **Units are inches.** Header set to imperial.
- **Geometry is nominal** — no kerf compensation applied.
- **Two layers.** `CUT` is the profile. `ETCH` is part-ID text only; send it to
  a marking op or delete the layer. Do not cut it.
- **LINE / ARC only**, AutoCAD R12 (AC1009). No splines or polylines. Every
  profile verified as a closed contour with no degenerate entities.
- Filleted stem root and filleted corners under the crossbar — no sharp notch
  to start a crack when somebody levers on the handle.

## Regenerating

```bash
python3 ../generate_skillet_blinds.py [output_dir]
```

Plain Python 3, no dependencies. `FLANGE` and `HANDLE` are keyed `(class, NPS)`;
`OVERRIDE` holds disc ODs that depart from the rule; `FLANGE_GAP` is the bare
stem past the flange edge; `MIN_BOLT_CLEAR` is the stem-to-bolt floor;
`TAG_HOLE` is `None` for plain skillets.
