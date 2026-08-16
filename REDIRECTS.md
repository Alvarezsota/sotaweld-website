# Redirecting stateofthearcweldingandservicesllc.com → sotaweld.com

The business has two websites. The old one is the one Google currently ranks;
sotaweld.com barely appears. Two sites for one business split the signals
instead of stacking them, so one has to win and the other has to point at it.

How much this matters, in proportion: the old domain was created 2025-07-31,
so it is about a year old and has not banked much authority. It outranks
sotaweld.com because it has indexed service pages, not because of deep history
— and sotaweld.com now has its own. Redirecting is worth doing and will speed
things up, but it is not the thing everything depends on. Repointing the
listings that link to the old site (see the checklist at the end) is available
without anyone's permission and carries much of the same benefit.

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

## Doing this without the old site's login

Redirects do not have to be set up inside the old website's editor. They happen
at the domain level, controlled by the **domain registrar** — a different
account from the website builder. If you can get into the registrar, you can
serve these redirects yourself and the old site simply stops being what answers
for that domain.

Looked up 2026-08-16, the domain is registered at **GoDaddy**, using GoDaddy's
own nameservers (`ns21/ns22.domaincontrol.com`). The registrant is masked by
Domains By Proxy, GoDaddy's privacy service, so the public record does not say
who owns it. It was created 2025-07-31 and expires 2027-07-31.

### Simplest route: GoDaddy's built-in forwarding

Because the domain is already at GoDaddy, no nameserver changes are needed.

1. Sign in to GoDaddy and open **My Products → Domains**.
2. Select the domain, then **Domain Settings → Forwarding → Add forwarding**.
3. Forward to `https://sotaweld.com`.
4. Set forward type to **Permanent (301)**. This is the setting that matters —
   a temporary (302) forward passes no ranking history.
5. Choose **Forward only**. Do *not* choose **Forward with masking**: masking
   keeps the old address in the browser bar while showing the new site, which
   is the opposite of telling Google the site moved, and creates duplicate
   content on top of it.

GoDaddy forwarding sends every path to one destination, so the per-page map
above collapses into "everything goes to the homepage." For a site this size
that captures most of the benefit, and it takes two minutes.

### If per-page redirects are wanted instead

Cloudflare is free and can map each old page to its matching new one. Worth it
only if the specific service pages turn out to be ranking well enough to be
worth preserving individually.

1. Create a Cloudflare account and add the old domain.
2. Cloudflare issues two nameservers.
3. At the registrar, replace the current nameservers with Cloudflare's.
4. Wait for the domain to show as Active in Cloudflare — usually under an hour.
5. Go to **Rules → Redirect Rules → Bulk Redirects**, create a list, and add
   the pairs below.

No hosting and no monthly cost — Cloudflare answers for the domain and issues
the 301s directly. Note that this does take the old site offline, which is the
intent.

### Bulk redirect list

Set every row to **301 permanent**. Turn **subpath matching** on for the blog
row so individual posts are caught, and off for the rest.

| Source | Target |
| --- | --- |
| `stateofthearcweldingandservicesllc.com/service-pipeline-welding` | `https://sotaweld.com/services/pipeline-welding.html` |
| `stateofthearcweldingandservicesllc.com/service-metal-fabrication` | `https://sotaweld.com/services/metal-fabrication.html` |
| `stateofthearcweldingandservicesllc.com/service-repair-and-maintenance` | `https://sotaweld.com/services/repair-and-maintenance.html` |
| `stateofthearcweldingandservicesllc.com/service-structural-welding` | `https://sotaweld.com/services/structural-steel-fabrication.html` |
| `stateofthearcweldingandservicesllc.com/service-mobile-welding` | `https://sotaweld.com/services/mobile-field-welding.html` |
| `stateofthearcweldingandservicesllc.com/service-custom-welding` | `https://sotaweld.com/services/metal-fabrication.html` |
| `stateofthearcweldingandservicesllc.com/service-automotive-welding` | `https://sotaweld.com/services/repair-and-maintenance.html` |
| `stateofthearcweldingandservicesllc.com/gallery-All` | `https://sotaweld.com/#services` |
| `stateofthearcweldingandservicesllc.com/gallery-Welding` | `https://sotaweld.com/work/compressor-stations.html` |
| `stateofthearcweldingandservicesllc.com/blog` | `https://sotaweld.com/` |

### The catch-all

Bulk Redirects only match what you list, so add one **Single Redirect Rule**
underneath to sweep up everything else, including the homepage and any page
neither of us knows about.

- Rule name: `catch-all to sotaweld`
- When incoming requests match: **All incoming requests**
- Then: **Static** redirect to `https://sotaweld.com/`
- Status: **301**
- Preserve query string: off

Bulk Redirects are evaluated before Single Redirect Rules, so the specific rows
above win and this only catches the leftovers.

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
