# Working notes for this repo

## Quotes — what Gilbert expects every time

Gilbert asked for this on 10-01-2026, after a quote went back and forth several
times and the two halves kept arriving separately.

**Every quote he asks for gets BOTH, without being asked twice:**

1. **A customer-facing PDF**, built with the `sota-quotes` skill, delivered to
   him in the conversation so he can attach it to an email there and then.
2. **A row on the Quotes desk** — `desk_quotes` plus one `desk_quote_lines` row
   per priced line, in Supabase project `woqzbterwialanccprhp`.

The desk row is not bookkeeping. It is what the **Convert to invoice** button
runs on, and the invoice is how he gets paid.

### The desk row has to be able to convert

`convert_quote_to_invoice(p_quote_id uuid)` REFUSES the conversion unless the
quote carries a `qb_customer_id`. A quote saved without one looks fine on the
desk and then fails at the one moment it matters. So:

- Look the customer up in `qb_customers` and put that id on the quote. For
  Desert Hills Electric Supply it is `158`.
- `rate_group` on each line is one of `shop`, `field`, `other`
  (see `desk_rate_groups`).
- `status` is `draft` until the convert flips it to `invoiced`.
- `doc_id` is `'q_' || replace(gen_random_uuid()::text, '-', '')`.
- The header `total` must equal the sum of `quantity * unit_price` across the
  lines. Check it after inserting; a header that disagrees with its own lines
  is a quote nobody can trust.

### Quote numbers

`SOTA-MM-DD-YYYY-NN` — month, day, year, then NN counting up within that day.
Month-day-year is what he asked for; do not reorder it. Check `desk_quotes` for
the highest NN already used for that date before picking one.

### Do not reprice on your own

He gives the figures. Multiply them out and tie the extension, but do not add a
margin, a quantity break or a discount he did not ask for. If something looks
wrong, say so in the reply — not on the customer's document.

### Nothing internal on the customer PDF

No cost, no markup, no shop hourly rate, no margin. He gave material at $962.99
plus 20% on 10-01; the document showed $1,155.59 and nothing else. Keep it that
way.
