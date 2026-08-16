# Redirecting stateofthearcweldingandservicesllc.com → sotaweld.com

The business has two websites. The old one is the one Google currently ranks;
sotaweld.com barely appears. Two sites for one business split the signals
instead of stacking them, so one has to win and the other has to point at it.

This is the single highest-impact change available. The on-page work in this
repo helps, but it cannot overcome a second site competing for the same name.

## What to do

On the old site's platform, set up **301 (permanent) redirects** using the map
below. A 301 tells Google the page moved for good and passes the ranking
history to the new address. A 302 (temporary) does not — it must be 301.

**Do not delete the old site.** Deleting it throws away the history instead of
transferring it. Keep the domain registered and the redirects live
indefinitely — at minimum a year, and there is no reason to ever turn them off.

Most site builders have this under Settings → Domains → Redirects, or as a
"URL redirect" / "301 redirect" feature. If the platform only offers a single
domain-wide forward, that is still worth doing: point the whole domain at
`https://sotaweld.com/` and accept that the per-page mapping is lost.

## The map

**Confirmed** — these exact URLs were found live in Google's index, so they are
the ones carrying ranking history and they matter most:

| Old URL | Redirect to |
| --- | --- |
| `/` | `https://sotaweld.com/` |
| `/service-pipeline-welding` | `https://sotaweld.com/services/pipeline-welding.html` |
| `/service-metal-fabrication` | `https://sotaweld.com/services/metal-fabrication.html` |
| `/service-repair-and-maintenance` | `https://sotaweld.com/services/repair-and-maintenance.html` |
| `/gallery-All` | `https://sotaweld.com/#services` |
| `/gallery-Welding` | `https://sotaweld.com/work/compressor-stations.html` |
| `/blog` | `https://sotaweld.com/` |
| `/blog/structural-integrity-the-critical-role/` | `https://sotaweld.com/` |

**Expected but unconfirmed** — the old site sells these services, and the three
confirmed URLs above establish the `/service-<name>` pattern, so these are very
likely the paths. Check them against the site's own page list before relying on
them; if a name differs, the destination stays the same:

| Old URL | Redirect to |
| --- | --- |
| `/service-structural-welding` | `https://sotaweld.com/services/structural-steel-fabrication.html` |
| `/service-mobile-welding` | `https://sotaweld.com/services/mobile-field-welding.html` |
| `/service-custom-welding` | `https://sotaweld.com/services/metal-fabrication.html` |
| `/service-automotive-welding` | `https://sotaweld.com/services/repair-and-maintenance.html` |

**Catch-all — set this one no matter what.** Everything not named above,
including blog posts and any page neither of us knows about, goes to
`https://sotaweld.com/`. This is the safety net: with it in place, nothing on
the old domain can 404 even if the two tables above are incomplete.

The fastest way to make the tables complete is to open the old site's page list
in its editor and read off the real URLs. If any are missing here, send them to
the closest matching service page — or let the catch-all take them.

Two of the mappings are deliberate approximations. The old site sold
*automotive welding* and *custom welding for homeowners*, which this business no
longer leads with. Rather than build residential pages that misrepresent the
work, those redirect to the closest industrial equivalent. If residential work
is still wanted, say so and those pages can be built properly.

## After the redirects are live

1. **Check them.** Visit two or three old URLs and confirm they land on the
   right sotaweld.com page, and that the address bar changes.
2. **Keep both properties in Search Console.** Do not remove the old one — it
   reports how the redirects are being processed.
3. **Use Change of Address** in the old property's settings if the platform
   allows a full domain redirect. This tells Google directly that the site
   moved, and is faster than letting it work that out on its own.
4. **Update the links that point at the old domain.** Facebook, Yelp,
   HomeAdvisor, Angi, Google Business Profile, business cards, truck lettering,
   invoices, email signatures. A redirect covers visitors; changing the actual
   links is what moves the ranking signal.

Expect weeks, not days, before search results reflect the move.

## Business details to keep identical everywhere

Google cross-checks these across every listing. They must match character for
character — no abbreviations on one and spelled out on another.

```
State of the Arc Welding & Services LLC
10234 West 64th Street
Odessa, TX 79764
(432) 248-1455
g.alvarez@sotaweld.com
https://sotaweld.com
Mon–Sat 7:00am – 5:30pm, closed Sunday
```

Some listings currently show **3636 North Francis Avenue**, which is wrong.
Every one of them needs correcting to the address above:

- [ ] Google Business Profile
- [ ] Yelp
- [ ] Facebook
- [ ] HomeAdvisor
- [ ] Angi
- [ ] The old website, until the redirects are live
