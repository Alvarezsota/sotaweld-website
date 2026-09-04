// Pushes one approved job-week into QuickBooks as an unsent invoice, and answers
// the question "what exactly would that be?" without pushing anything.
//
// Admin-only: verify_jwt is on and the caller's login is checked against
// profiles.role, so a welder cannot bill a customer.
//
// The token endpoint comes from Intuit's cached OpenID discovery document rather
// than a literal, so a change at Intuit is followed instead of breaking. Every
// QuickBooks response records its intuit_tid - the id their support asks for,
// which cannot be recovered after the call.
//
// ---------------------------------------------------------------------------
// PREVIEW AND PUSH ARE THE SAME CALL
// ---------------------------------------------------------------------------
//
// dryRun builds the identical payload from the identical function and returns it
// without contacting QuickBooks. That is what makes the preview worth looking at:
// it is not a drawing of an invoice, it is the invoice. Anything that would stop
// the push comes back with it as `blockers`, so the preview says why the button
// is not going to work rather than leaving him to find out by pressing it.
//
// A preview never refuses. A week that is not approved, a job with no customer
// mapped, a connection pointing at the wrong company - all of them still draw the
// invoice and name the problem underneath it.
//
// ---------------------------------------------------------------------------
// THREE KINDS OF INVOICE, ONE PUSH
// ---------------------------------------------------------------------------
//
// A job week is a week of labour that has been approved. A parts invoice is
// plate that went on the laser and came off as parts, with no week and nobody's
// hours behind it. A desk invoice is a quote the office turned into a bill.
// They are different things and they are billed the same way, so all three
// build a payload of the same shape in Postgres and everything from there down
// -- the refusals, the token, the number, the write-back -- is one piece of
// code. Pass one of job_week_id, parts_invoice_id or desk_invoice_id; the rest
// does not care which arrived.
//
// ---------------------------------------------------------------------------
// AND ONE CUSTOMER LOOKUP
// ---------------------------------------------------------------------------
//
// action:"create_customer" lives here rather than in a function of its own for
// one reason: Intuit rotates the refresh token on every use, so two places
// refreshing it independently is two ways to lose the connection. One function
// holds the token, so one function does the talking.
//
// ---------------------------------------------------------------------------
// THE CREW SHEET GOES WITH IT
// ---------------------------------------------------------------------------
//
// A labour line reads "Welder labor - 96.00 hrs". Straight after the invoice is
// created, the week's crew sheet -- every name, every day, the hours against
// each -- is attached to it in QuickBooks, marked to travel with the invoice
// when it is sent. The bill and the answer to "who were those hours?" stop being
// two documents that somebody has to remember to put in the same envelope.
//
// It is attached after the invoice exists, and it cannot un-create it. So a
// failure here is reported and logged and never turned into a failed push: the
// invoice is real either way, and telling him it failed would have him push a
// second one. The sheet can be pulled any time from qb-invoice-backup.
//
// A parts invoice has no week and nobody's hours behind it, so there is nothing
// to attach and none is attempted.
//
// ---------------------------------------------------------------------------
// THE INVOICE NUMBER
// ---------------------------------------------------------------------------
//
// The portal's number goes out as DocNumber, and whatever QuickBooks actually
// puts on the invoice is written back over it. QuickBooks is the book of record;
// if it assigns something else, the portal follows rather than arguing, because
// two numbers for one week is worse than either number.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { attachToInvoice, buildBackupForJobWeek } from "../_shared/invoice-backup-data.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const CLIENT_ID = Deno.env.get("QB_CLIENT_ID") ?? "";
const CLIENT_SECRET = Deno.env.get("QB_CLIENT_SECRET") ?? "";

const FALLBACK_TOKEN = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
// Not published in the discovery document - it is the API host, not an OAuth endpoint.
const API_BASE = (env: string) =>
  env === "production"
    ? "https://quickbooks.api.intuit.com"
    : "https://sandbox-quickbooks.api.intuit.com";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPPORT = "State of the Arc office - (432) 248-1455 - g.alvarez@sotaweld.com";

type Tokens = {
  realm_id: string; environment: string;
  access_token: string; refresh_token: string; expires_at: string;
};

/** Retries transient faults only. A 4xx is QuickBooks meaning it. */
async function fetchWithRetry(url: string, init: RequestInit, attempts = 3): Promise<Response> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, init);
      if (res.status < 500 && res.status !== 429) return res;
      if (i === attempts - 1) return res;
    } catch (e) {
      lastErr = e;
      if (i === attempts - 1) throw e;
    }
    await new Promise((r) => setTimeout(r, 400 * Math.pow(2, i)));
  }
  throw lastErr ?? new Error("request failed");
}

async function liveToken(db: ReturnType<typeof createClient>): Promise<Tokens> {
  const { data: row, error } = await db.from("qb_oauth_tokens").select("*").eq("id", 1).maybeSingle();
  if (error) throw new Error(`token read failed: ${error.message}`);
  if (!row) throw new Error("QuickBooks is not connected. Reconnect the portal to QuickBooks.");

  const t = row as unknown as Tokens;
  if (new Date(t.expires_at).getTime() - Date.now() > 60_000) return t;

  const { data: cfg } = await db.from("qb_oidc_config")
    .select("token_endpoint").eq("environment", t.environment).maybeSingle();
  const tokenEndpoint = cfg?.token_endpoint ?? FALLBACK_TOKEN;

  const res = await fetchWithRetry(tokenEndpoint, {
    method: "POST",
    headers: {
      Authorization: "Basic " + btoa(`${CLIENT_ID}:${CLIENT_SECRET}`),
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: t.refresh_token }),
  });
  const tok = await res.json().catch(() => ({}));
  if (!res.ok || !tok.access_token) {
    throw new Error(
      `could not refresh the QuickBooks token (${res.status}). ` +
      `If the connection has expired, reconnect the portal to QuickBooks. ` +
      `${JSON.stringify(tok).slice(0, 200)}`);
  }

  const now = Date.now();
  const next = {
    access_token: tok.access_token as string,
    refresh_token: (tok.refresh_token ?? t.refresh_token) as string,
    expires_at: new Date(now + (Number(tok.expires_in) || 3600) * 1000).toISOString(),
    refresh_expires_at: tok.x_refresh_token_expires_in
      ? new Date(now + Number(tok.x_refresh_token_expires_in) * 1000).toISOString()
      : null,
    updated_at: new Date().toISOString(),
  };
  await db.from("qb_oauth_tokens").update(next).eq("id", 1);
  return { ...t, ...next };
}

/* ---------------------------------------------------------------------------
   ADDING A CUSTOMER
   ---------------------------------------------------------------------------
   qb_customers is a copy of what QuickBooks knows, kept here so a parts invoice
   can be written on a phone in the shop with no QuickBooks session near it. A
   customer added to the copy alone would be a customer QuickBooks has never
   heard of, and the invoice naming it would be rejected on the way out -- after
   the number had been spent. So adding one goes to QuickBooks first and the
   copy follows.

   QuickBooks is asked whether it already has the name before anything is
   created. That is the whole anti-duplication story: a customer set up over
   there last week gets picked up and mirrored rather than raised a second time,
   and the same name typed twice in a row lands on the same customer both times.
*/
async function createCustomer(
  db: ReturnType<typeof createClient>,
  body: Record<string, unknown>,
  json: (b: Record<string, unknown>, status?: number) => Response,
): Promise<Response> {
  const name = String(body.display_name ?? "").trim();
  const company = String(body.company_name ?? "").trim();
  const email = String(body.email ?? "").trim();

  if (!name) return json({ ok: false, error: "give the customer a name" }, 400);
  // QuickBooks' own limit. Saying so here beats letting Intuit answer with a
  // validation fault he has to decode.
  if (name.length > 100) {
    return json({ ok: false, error: "that name is too long for QuickBooks (100 characters)" }, 400);
  }
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return json({ ok: false, error: "that email address does not look right" }, 400);
  }

  const t = await liveToken(db);
  const base = `${API_BASE(t.environment)}/v3/company/${t.realm_id}`;
  const headers = {
    Authorization: `Bearer ${t.access_token}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  const mirror = async (c: Record<string, unknown>, created: boolean) => {
    const row = {
      id: String(c.Id),
      environment: t.environment,
      display_name: String(c.DisplayName ?? name),
      company_name: (c.CompanyName as string) ?? null,
      active: c.Active === false ? false : true,
      synced_at: new Date().toISOString(),
    };
    const { error } = await db.from("qb_customers")
      .upsert(row, { onConflict: "environment,id" });
    if (error) throw new Error(`added in QuickBooks but not to the portal list: ${error.message}`);
    return json({ ok: true, created, customer: row });
  };

  // Does QuickBooks already have it? Doubling the quote is how a name like
  // O'Brien Fabrication gets through the query intact.
  const q = `select * from Customer where DisplayName = '${name.replace(/'/g, "''")}'`;
  const lookup = await fetchWithRetry(
    `${base}/query?query=${encodeURIComponent(q)}&minorversion=75`, { method: "GET", headers });
  const found = await lookup.json().catch(() => ({}));
  if (lookup.ok) {
    const hit = found?.QueryResponse?.Customer?.[0];
    if (hit) return await mirror(hit, false);
  }

  const res = await fetchWithRetry(`${base}/customer?minorversion=75`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      DisplayName: name,
      ...(company ? { CompanyName: company } : {}),
      ...(email ? { PrimaryEmailAddr: { Address: email } } : {}),
    }),
  });
  const tid = res.headers.get("intuit_tid");
  const out = await res.json().catch(() => ({}));

  if (!res.ok || !out?.Customer?.Id) {
    const fault = out?.Fault?.Error?.[0];
    // 6240 is QuickBooks saying the name is taken -- by a customer the lookup
    // above could not see, which means it is there but switched off.
    const duplicate = String(fault?.code ?? "") === "6240";
    return json({
      ok: false,
      error: duplicate
        ? `QuickBooks already has a customer called "${name}", but it is switched off over there. Turn it back on in QuickBooks and it will show up here.`
        : "QuickBooks would not add that customer",
      quickbooks_message: fault?.Message ?? null,
      quickbooks_detail: fault?.Detail ?? null,
      quickbooks_code: fault?.code ?? null,
      intuit_tid: tid,
      http_status: res.status,
      note: "Nothing was created.",
    }, duplicate ? 409 : 502);
  }

  // Best effort only. The customer exists in QuickBooks by now, and a log row
  // that will not go in is not a reason to tell him it failed.
  try {
    await db.from("qb_push_log").insert({
      action: "create_customer", status: "sent", intuit_tid: tid, http_status: res.status,
      detail: `added customer ${out.Customer.DisplayName} (${out.Customer.Id})`.slice(0, 780),
    });
  } catch { /* ignore */ }

  return await mirror(out.Customer, true);
}

/* ---------------------------------------------------------------------------
   RECONCILING A PUSHED WEEK WITH QUICKBOOKS
   ---------------------------------------------------------------------------
   Two things drift after a push, and both were found the hard way.

   The invoice can be deleted over there. The portal goes on holding its id and
   refusing to unlock the week -- a pointer to a document that does not exist.
   Deleting it in QuickBooks is the office saying "start that one again", so the
   portal should hear it rather than have to be told.

   And the sheet attached to it can be wrong. Seven invoices went out carrying
   crew sheets with the notes a man typed on his phone, because they were pushed
   before those came off. Deleting and re-pushing seven invoices to swap seven
   attachments is not a repair, it is a bigger mess. The attachment is the only
   part that is wrong, so the attachment is the only part that changes.

   Asking is one query for every id at once rather than one call each, because
   this runs on a page load and a page load should cost QuickBooks one round
   trip, not eight.
*/
async function qbExistingInvoiceIds(t: Tokens, ids: string[]): Promise<Set<string>> {
  const found = new Set<string>();
  if (!ids.length) return found;
  const inList = ids.map((i) => `'${i.replace(/'/g, "''")}'`).join(",");
  const q = `select Id from Invoice where Id in (${inList})`;
  const res = await fetchWithRetry(
    `${API_BASE(t.environment)}/v3/company/${t.realm_id}/query?query=${encodeURIComponent(q)}&minorversion=75`,
    { method: "GET", headers: { Authorization: `Bearer ${t.access_token}`, Accept: "application/json" } });
  if (!res.ok) {
    // A query that will not run is not evidence that anything was deleted.
    // Saying nothing is missing is the safe answer: it unlocks nothing.
    throw new Error(`could not ask QuickBooks which invoices exist (${res.status})`);
  }
  const out = await res.json().catch(() => ({}));
  for (const inv of (out?.QueryResponse?.Invoice ?? [])) found.add(String(inv.Id));
  return found;
}

/* THE HIGHEST INVOICE NUMBER QUICKBOOKS HAS SPENT
   ---------------------------------------------------------------------------
   The portal's counter only knows what the portal has issued. An invoice typed
   straight into QuickBooks never touches it, so the counter drifts behind and
   starts offering numbers that are already on a customer's invoice.

   Asked as two queries rather than one, because the cheap one answers it
   almost every time:

     1. How many invoices are numbered at or above what we were about to
        offer? Almost always none, and then there is nothing to do and we
        have spent one count query.
     2. Only if there are, fetch them and take the real highest.

   ON COMPARING NUMBERS AS TEXT: DocNumber is a string over there, so `>=` and
   ORDERBY are alphabetical. For numbers of the same length that is the same
   order; it stops being so at a digit-length boundary, where '9999' sorts
   above '10000'. Step 2 therefore parses what comes back and takes the
   arithmetic maximum rather than trusting the sort, and the caller can only
   ever move the counter forward. The failure that survives all that is
   offering a number lower than it could have been, which costs a gap in the
   sequence and nothing else. */
async function qbHighestInvoiceNo(t: Tokens, from: number): Promise<number | null> {
  const base = `${API_BASE(t.environment)}/v3/company/${t.realm_id}`;
  const headers = { Authorization: `Bearer ${t.access_token}`, Accept: "application/json" };
  const ask = async (q: string) => {
    const res = await fetchWithRetry(
      `${base}/query?query=${encodeURIComponent(q)}&minorversion=75`, { method: "GET", headers });
    if (!res.ok) {
      // Not knowing is not the same as knowing there is nothing. The caller
      // leaves the counter alone rather than guessing it is fine.
      throw new Error(`could not ask QuickBooks for its invoice numbers (${res.status})`);
    }
    return await res.json().catch(() => ({}));
  };

  const floor = String(from);
  const counted = await ask(`select count(*) from Invoice where DocNumber >= '${floor}'`);
  const n = Number(counted?.QueryResponse?.totalCount ?? 0);
  if (!Number.isFinite(n) || n <= 0) return null;

  const rows = await ask(
    `select * from Invoice where DocNumber >= '${floor}' orderby DocNumber desc maxresults 100`);
  let high: number | null = null;
  for (const inv of (rows?.QueryResponse?.Invoice ?? [])) {
    const raw = String(inv?.DocNumber ?? "");
    if (!/^\d+$/.test(raw)) continue;   // a lettered number is not on our sequence
    const v = Number(raw);
    if (Number.isSafeInteger(v) && (high === null || v > high)) high = v;
  }
  return high;
}

/** action:"sync_invoice_no" -- called when a page that shows the next invoice
 *  number loads, before it shows it.
 *
 *  Read-only as far as QuickBooks is concerned: it asks a question and moves
 *  our own counter. It never renumbers anything over there.
 *
 *  QuickBooks being unreachable leaves the counter untouched and says so. The
 *  page still has peek_invoice_no to fall back on -- a number that might
 *  collide is better than no number at all, and the push still refuses a
 *  duplicate with fault 6140. */
async function syncInvoiceNo(
  db: ReturnType<typeof createClient>,
  json: (b: Record<string, unknown>, status?: number) => Response,
): Promise<Response> {
  const { data: before, error: readErr } = await db.rpc("bump_invoice_counter", { p_at_least: null });
  if (readErr) return json({ ok: false, error: readErr.message }, 500);
  const was = Number(before);

  const t = await liveToken(db);
  const high = await qbHighestInvoiceNo(t, was);
  if (high === null) {
    return json({ ok: true, next_invoice_no: String(was), was: String(was),
                  moved: false, highest_in_quickbooks: null });
  }

  const { data: after, error: bumpErr } = await db.rpc("bump_invoice_counter", { p_at_least: high + 1 });
  if (bumpErr) return json({ ok: false, error: bumpErr.message }, 500);

  const now = Number(after);
  if (now !== was) {
    await db.from("qb_push_log").insert({
      action: "sync_invoice_no", status: "sent",
      detail: `QuickBooks is up to invoice ${high}; next number moved from ${was} to ${now}`.slice(0, 780),
    });
  }
  return json({ ok: true, next_invoice_no: String(now), was: String(was),
                moved: now !== was, highest_in_quickbooks: String(high) });
}

/* KEEPING THE COPIES OF QUICKBOOKS' OWN LISTS CURRENT
   ---------------------------------------------------------------------------
   qb_items and qb_customers are copies, so a parts invoice can be written on a
   phone in the shop with no QuickBooks session near it. Nothing refreshed them.
   They were filled once and left.

   That went wrong exactly as you would expect. The item list was copied on
   26 August at 15:07. "Gas & consumables", "Material", "Truck & rig",
   "Mileage", the two laser items and three more were created in QuickBooks at
   15:51 -- forty-five minutes later. For three days the parts invoice screen
   could not offer any of them, and there was no way to tell from the screen
   that anything was missing: the dropdown looked complete, it was just short.

   A copy nobody refreshes is a copy that is wrong and does not say so. So the
   parts invoice page asks on load, and this answers.

   THROTTLED HERE RATHER THAN IN THE PAGE. Ten minutes, so opening the screen
   five times in a row costs QuickBooks one round trip rather than five, and so
   there is one rule about it instead of one per caller. force:true skips it,
   for the button that says "I have just added something over there". */
const LIST_FRESH_MS = 10 * 60 * 1000;

async function qbFetchAll(t: Tokens, entity: "Item" | "Customer"): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  const base = `${API_BASE(t.environment)}/v3/company/${t.realm_id}`;
  const headers = { Authorization: `Bearer ${t.access_token}`, Accept: "application/json" };

  // Active and inactive both. Without the inactive half a thing switched off in
  // QuickBooks stays on the dropdown here for ever, and billing against it is
  // an invoice QuickBooks will refuse after the number has been spent.
  for (const activeClause of ["Active = true", "Active = false"]) {
    let start = 1;
    for (let page = 0; page < 20; page++) {          // 20,000 of anything is not this shop
      const q = `select * from ${entity} where ${activeClause} startposition ${start} maxresults 1000`;
      const res = await fetchWithRetry(
        `${base}/query?query=${encodeURIComponent(q)}&minorversion=75`, { method: "GET", headers });
      if (!res.ok) throw new Error(`could not read the ${entity.toLowerCase()} list (${res.status})`);
      const body = await res.json().catch(() => ({}));
      const rows = body?.QueryResponse?.[entity] ?? [];
      out.push(...rows);
      if (rows.length < 1000) break;
      start += rows.length;
    }
  }
  return out;
}

/** action:"sync_lists" -- refreshes the copies of QuickBooks' item and customer
 *  lists. Reads QuickBooks; writes only our own copies. */
async function syncLists(
  db: ReturnType<typeof createClient>,
  body: Record<string, unknown>,
  json: (b: Record<string, unknown>, status?: number) => Response,
): Promise<Response> {
  const force = Boolean(body.force);

  if (!force) {
    const { data: newest } = await db.from("qb_items")
      .select("synced_at").order("synced_at", { ascending: false }).limit(1).maybeSingle();
    const at = newest?.synced_at ? new Date(String(newest.synced_at)).getTime() : 0;
    if (at && Date.now() - at < LIST_FRESH_MS) {
      return json({ ok: true, skipped: true, reason: "the lists were refreshed a moment ago" });
    }
  }

  const t = await liveToken(db);
  const now = new Date().toISOString();

  const items = await qbFetchAll(t, "Item");
  const itemRows = items.map((i) => ({
    id: String(i.Id),
    environment: t.environment,
    name: String(i.Name ?? ""),
    item_type: (i.Type as string) ?? null,
    active: i.Active !== false,
    synced_at: now,
  }));
  if (itemRows.length) {
    const { error } = await db.from("qb_items").upsert(itemRows, { onConflict: "environment,id" });
    if (error) throw new Error(`the item list would not save: ${error.message}`);
  }

  const customers = await qbFetchAll(t, "Customer");
  const custRows = customers.map((c) => ({
    id: String(c.Id),
    environment: t.environment,
    display_name: String(c.DisplayName ?? ""),
    company_name: (c.CompanyName as string) ?? null,
    active: c.Active !== false,
    synced_at: now,
  }));
  if (custRows.length) {
    const { error } = await db.from("qb_customers").upsert(custRows, { onConflict: "environment,id" });
    if (error) throw new Error(`the customer list would not save: ${error.message}`);
  }

  return json({
    ok: true,
    skipped: false,
    items: itemRows.length,
    items_active: itemRows.filter((r) => r.active).length,
    customers: custRows.length,
    customers_active: custRows.filter((r) => r.active).length,
  });
}

/** Takes the old crew sheet off an invoice and puts the current one on.
 *
 *  The delete comes first and its failure stops the upload. Two sheets on one
 *  invoice, one of them the one we were trying to get rid of, is worse than the
 *  single stale sheet we started with -- and it is the customer who would open
 *  both. */
async function replaceCrewSheet(
  db: ReturnType<typeof createClient>, t: Tokens, invoiceId: string, jobWeekId: string,
): Promise<Record<string, unknown>> {
  const base = `${API_BASE(t.environment)}/v3/company/${t.realm_id}`;
  const headers = {
    Authorization: `Bearer ${t.access_token}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  const q = `select * from Attachable where AttachableRef.EntityRef.Value = '${invoiceId}'`;
  const look = await fetchWithRetry(
    `${base}/query?query=${encodeURIComponent(q)}&minorversion=75`, { method: "GET", headers });
  if (!look.ok) {
    return { ok: false, error: `could not read the invoice's attachments (${look.status})` };
  }
  const existing = (await look.json().catch(() => ({})))?.QueryResponse?.Attachable ?? [];

  // Only ours. A drawing or a signed ticket somebody attached by hand stays
  // exactly where it is.
  const ours = existing.filter((a: Record<string, unknown>) =>
    String(a.FileName ?? "").startsWith("Crew time backup"));

  const removed: string[] = [];
  for (const a of ours) {
    const del = await fetchWithRetry(`${base}/attachable?operation=delete&minorversion=75`, {
      method: "POST", headers,
      body: JSON.stringify({ Id: String(a.Id), SyncToken: String(a.SyncToken ?? "0") }),
    });
    if (!del.ok) {
      return { ok: false, removed,
        error: `could not remove the old crew sheet (${del.status}). Nothing was uploaded, so the invoice still has one sheet rather than two.` };
    }
    removed.push(String(a.Id));
  }

  const sheet = await buildBackupForJobWeek(db as never, jobWeekId);
  if (!sheet.ok) return { ok: false, removed, error: sheet.error };

  const att = await attachToInvoice({
    apiBase: API_BASE(t.environment), realmId: t.realm_id, accessToken: t.access_token,
    invoiceId, pdf: sheet.pdf, filename: sheet.filename,
  });
  if (!att.ok) return { ok: false, removed, error: att.error };

  return { ok: true, removed_count: removed.length,
           attachable_id: att.attachable_id, filename: sheet.filename };
}

/** action:"reconcile" -- what the Approvals page calls for its synced weeks.
 *
 *  With refresh_sheets off it only asks which invoices are still there, which
 *  is one query and safe to run on every page load. With it on it also swaps
 *  the sheet on the ones that remain. */
async function reconcile(
  db: ReturnType<typeof createClient>,
  body: Record<string, unknown>,
  json: (b: Record<string, unknown>, status?: number) => Response,
): Promise<Response> {
  const ids = Array.isArray(body.job_week_ids) ? body.job_week_ids.map(String) : [];
  const refresh = Boolean(body.refresh_sheets);
  if (!ids.length) return json({ ok: true, checked: 0, results: [] });

  const { data: rows } = await db.from("job_weeks")
    .select("id, invoice_no, status, qb_invoice_id").in("id", ids);
  const synced = (rows ?? []).filter((r: Record<string, unknown>) =>
    r.status === "synced" && r.qb_invoice_id);
  if (!synced.length) return json({ ok: true, checked: 0, results: [] });

  const t = await liveToken(db);
  const alive = await qbExistingInvoiceIds(
    t, synced.map((r: Record<string, unknown>) => String(r.qb_invoice_id)));

  const results: Record<string, unknown>[] = [];
  for (const r of synced) {
    const row = r as Record<string, unknown>;
    const qbId = String(row.qb_invoice_id);

    if (!alive.has(qbId)) {
      // Gone over there. The week comes back on its own number.
      const { data: undone } = await db.rpc("unsync_job_week", {
        p_job_week_id: row.id,
        p_reason: `invoice ${qbId} no longer exists in QuickBooks`,
      });
      results.push({ job_week_id: row.id, invoice_no: row.invoice_no,
                     qb_invoice_id: qbId, action: "unsynced", detail: undone });
      continue;
    }

    if (!refresh) {
      results.push({ job_week_id: row.id, invoice_no: row.invoice_no,
                     qb_invoice_id: qbId, action: "still_there" });
      continue;
    }

    const swap = await replaceCrewSheet(db, t, qbId, String(row.id));
    if (!swap.ok) {
      await db.from("qb_push_log").insert({
        job_week_id: row.id, action: "refresh_backup", status: "error",
        qb_invoice_id: qbId, detail: String(swap.error ?? "unknown").slice(0, 780),
      });
    } else {
      await db.from("qb_push_log").insert({
        job_week_id: row.id, action: "refresh_backup", status: "sent",
        qb_invoice_id: qbId,
        detail: `replaced the crew sheet on invoice ${row.invoice_no} (${swap.removed_count} old removed)`.slice(0, 780),
      });
    }
    results.push({ job_week_id: row.id, invoice_no: row.invoice_no, qb_invoice_id: qbId,
                   action: swap.ok ? "sheet_replaced" : "sheet_failed", detail: swap });
  }

  return json({
    ok: true,
    checked: synced.length,
    unsynced: results.filter((r) => r.action === "unsynced").length,
    replaced: results.filter((r) => r.action === "sheet_replaced").length,
    failed: results.filter((r) => r.action === "sheet_failed").length,
    results,
  });
}

/** What each kind of invoice is made of. Everything below this reads the
 *  descriptor rather than asking which kind it is holding. */
const SOURCES = {
  week: {
    table: "job_weeks", rpc: "qb_invoice_payload", arg: "p_job_week_id",
    ready: "approved", noun: "job week",
    notReady: (status: string) => `This week is "${status}". Approve it before it can be invoiced.`,
  },
  parts: {
    table: "parts_invoices", rpc: "parts_invoice_payload", arg: "p_invoice_id",
    ready: "ready", noun: "invoice",
    notReady: () => "This invoice is still a draft. Mark it finished before it can be sent.",
  },
  // A desk invoice has no approval step of its own: converting the quote is the
  // decision to bill it, and that already spent an invoice number.
  desk: {
    table: "desk_invoices", rpc: "desk_invoice_payload", arg: "p_invoice_id",
    ready: null as string | null, noun: "invoice",
    notReady: () => "",
  },
} as const;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const json = (b: Record<string, unknown>, status = 200) =>
    new Response(JSON.stringify({ ...b, support: SUPPORT }, null, 2),
      { status, headers: { ...CORS, "Content-Type": "application/json" } });

  let jobWeekId: string | null = null;

  try {
    const auth = req.headers.get("Authorization") ?? "";
    const asCaller = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: auth } } });
    const { data: who } = await asCaller.auth.getUser();
    if (!who?.user) return json({ ok: false, error: "not signed in" }, 401);
    const { data: me } = await db.from("profiles").select("role, full_name").eq("id", who.user.id).maybeSingle();
    if (me?.role !== "admin") return json({ ok: false, error: "admins only" }, 403);

    const body = await req.json().catch(() => ({}));
    // Adding a customer is the one thing here that is not an invoice. It is
    // answered before any of the invoice machinery starts.
    if (body.action === "create_customer") return await createCustomer(db, body, json);
    // Asking QuickBooks what is still there, and swapping a stale crew sheet.
    if (body.action === "reconcile") return await reconcile(db, body, json);

    // Asking what number to offer next. Reads QuickBooks, writes only our
    // own counter.
    if (body.action === "sync_invoice_no") return await syncInvoiceNo(db, json);

    // Refreshing our copies of QuickBooks' item and customer lists.
    if (body.action === "sync_lists") return await syncLists(db, body, json);

    jobWeekId = body.job_week_id ?? null;
    const partsInvoiceId: string | null = body.parts_invoice_id ?? null;
    const deskInvoiceId: string | null = body.desk_invoice_id ?? null;
    const dryRun = Boolean(body.dryRun);
    const forceBad = Boolean(body.__testBadRequest);

    const given = [
      ["week", jobWeekId], ["parts", partsInvoiceId], ["desk", deskInvoiceId],
    ].filter(([, v]) => Boolean(v)) as [keyof typeof SOURCES, string][];

    if (given.length === 0) {
      return json({ ok: false, error: "job_week_id, parts_invoice_id or desk_invoice_id is required" }, 400);
    }
    if (given.length > 1) {
      return json({ ok: false, error: "pass one of job_week_id, parts_invoice_id or desk_invoice_id, not several" }, 400);
    }
    const [kind, rowId] = given[0];
    const src = SOURCES[kind];
    const isParts = kind === "parts";

    // Everything that would stop a push, gathered rather than thrown, so the
    // preview can show all of it at once instead of one problem per attempt.
    const blockers: { code: string; message: string }[] = [];

    const { data: ready } = await db.rpc("qb_push_readiness");
    if (ready && ready.safe_to_push !== true) {
      blockers.push({
        code: "environment",
        message: `QuickBooks is connected to the ${ready.connected_environment} company but the jobs are mapped to ${ready.mapping_environment}. ` +
                 `Reconnect the portal to the ${ready.mapping_environment} company before pushing.`,
      });
    }

    const table = src.table;
    const { data: row } = await db.from(table)
      .select("id, status, qb_invoice_id, invoice_no").eq("id", rowId).maybeSingle();
    if (!row) return json({ ok: false, error: `${src.noun} not found` }, 404);

    if (row.qb_invoice_id) {
      blockers.push({
        code: "already_pushed",
        message: `${kind === "week" ? "This week is" : "This invoice is"} already on QuickBooks invoice ${row.qb_invoice_id}. Nothing would be created.`,
      });
    }
    // A week is ready when it has been approved; a parts invoice when it has
    // been marked finished. Same idea, different word on each screen. A desk
    // invoice has no such step, so it has no such refusal.
    if (src.ready && row.status !== src.ready && row.status !== "synced") {
      blockers.push({ code: "not_approved", message: src.notReady(String(row.status)) });
    }

    const { data: payload, error: pErr } = await db.rpc(src.rpc, { [src.arg]: rowId });
    if (pErr) throw new Error(`payload build failed: ${pErr.message}`);
    if (payload?.error) {
      blockers.push({ code: "payload", message: payload.error });
      if (dryRun) return json({ ok: true, dryRun: true, payload, blockers, readiness: ready });
      return json({ ok: false, error: payload.error, blockers }, 422);
    }

    const linesTotal = Number(payload?.lines_total ?? 0);
    const expected = Number(payload?.expected_total ?? 0);
    if (Math.abs(linesTotal - expected) > 0.01) {
      blockers.push({
        code: "totals",
        message: `The invoice lines come to ${linesTotal.toFixed(2)} but the portal says the week is worth ${expected.toFixed(2)}. ` +
                 `Nothing will be pushed until those agree.`,
      });
    }

    // A preview never refuses and never touches QuickBooks. It draws the invoice
    // and hands back whatever would stand in the way of sending it.
    if (dryRun) {
      return json({ ok: true, dryRun: true, payload, blockers, readiness: ready });
    }

    if (blockers.length && !forceBad) {
      const first = blockers[0];
      // Already pushed is not a failure -- it is the right answer to asking twice.
      if (first.code === "already_pushed" && blockers.length === 1) {
        return json({ ok: true, alreadyPushed: true, qb_invoice_id: row.qb_invoice_id, note: first.message });
      }
      await db.from("qb_push_log").insert({
        job_week_id: jobWeekId, action: "push_invoice", status: "blocked",
        amount: linesTotal || null,
        detail: (kind === "week" ? "" : `${kind} invoice ${rowId}: `) +
          blockers.map((b) => `${b.code}: ${b.message}`).join(" | ").slice(0, 780),
      });
      return json({ ok: false, error: first.message, blockers }, 409);
    }

    const t = await liveToken(db);

    // Who gets copied. QuickBooks holds CC on the invoice, not the customer -
    // there is no customer-level CC field - so without this the addresses would
    // have to be retyped on every invoice and one would eventually be missed.
    // Keyed on the customer rather than the job, because seventeen jobs bill to
    // Rocking Double S; and by environment, for the same reason
    // jobs.qb_environment exists - the same id is a different company in sandbox.
    //
    // A missing row is the normal case, and a failed lookup falls back to the
    // address already on the QuickBooks customer record. This must never be the
    // reason an invoice does not go out.
    let billTo: Record<string, unknown> = {};
    // How this one settles up: whether Pay Now appears, and on what terms. Same
    // row, same trip, because who an invoice goes to and how it gets paid are
    // the same question about the same customer.
    let settle: Record<string, unknown> = {};
    try {
      const { data: bill } = await db
        .from("qb_customer_billing")
        .select("to_email, cc_emails, bcc_emails, allow_online_payment, qb_term_id")
        .eq("qb_customer_id", String(payload.customer.id))
        .eq("qb_environment", t.environment)
        .maybeSingle();
      if (bill) {
        const join = (v: unknown) =>
          Array.isArray(v) ? (v as string[]).map((s) => s.trim()).filter(Boolean).join(", ") : "";
        const cc = join(bill.cc_emails);
        const bcc = join(bill.bcc_emails);
        if (bill.to_email) billTo.BillEmail = { Address: String(bill.to_email) };
        if (cc) billTo.BillEmailCc = { Address: cc };
        if (bcc) billTo.BillEmailBcc = { Address: bcc };

        // Only ever written when the answer is no. Left off entirely otherwise,
        // so a customer with no row keeps whatever QuickBooks does on its own
        // rather than having the current default frozen onto every invoice.
        //
        // These three are the writable ones. AllowOnlinePayment and
        // AllowOnlinePayPalPayment are derived by QuickBooks from them, so
        // clearing these clears the Pay Now button and everything under it.
        if (bill.allow_online_payment === false) {
          settle.AllowOnlineCreditCardPayment = false;
          settle.AllowOnlineACHPayment = false;
          settle.AllowIPNPayment = false;
        }
        // Stamped rather than inherited. QuickBooks does inherit the term from
        // the customer record, and does today, but that is a default somebody
        // can change in another screen without anyone noticing.
        if (bill.qb_term_id) settle.SalesTermRef = { value: String(bill.qb_term_id) };
      }
    } catch (_e) {
      // Never the reason an invoice does not go out. A customer who should not
      // be offered a card is a worse invoice, not a failed one.
      billTo = {};
      settle = {};
    }

    // The number the portal proposes. Left off entirely when there is none, so
    // QuickBooks assigns its own rather than being handed a blank.
    const docNumber = payload.invoice_no ? String(payload.invoice_no).slice(0, 21) : null;

    const qbInvoice = forceBad
      ? { Line: [{ Amount: "not-a-number", DetailType: "SalesItemLineDetail", SalesItemLineDetail: {} }] }
      : {
        CustomerRef: { value: payload.customer.id },
        TxnDate: payload.transaction_date,
        PrivateNote: payload.memo,
        ...(docNumber ? { DocNumber: docNumber } : {}),
        // A PO number is what the customer's own accounts department matches
        // against, so it goes where QuickBooks prints it rather than into a memo.
        ...(payload.po_number ? { CustomerMemo: { value: `PO ${payload.po_number}` } } : {}),
        ...billTo,
        ...settle,
        Line: (payload.lines as Array<Record<string, unknown>>).map((l) => ({
          Amount: Number(l.amount),
          Description: l.description,
          DetailType: "SalesItemLineDetail",
          SalesItemLineDetail: {
            ItemRef: { value: (l.item as { id: string }).id },
            ...(l.quantity ? { Qty: Number(l.quantity) } : {}),
            ...(l.unit_price ? { UnitPrice: Number(l.unit_price) } : {}),
          },
        })),
      };

    const res = await fetchWithRetry(
      `${API_BASE(t.environment)}/v3/company/${t.realm_id}/invoice?minorversion=75`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${t.access_token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(qbInvoice),
      },
    );

    const tid = res.headers.get("intuit_tid");
    const out = await res.json().catch(() => ({}));

    if (!res.ok || !out?.Invoice?.Id) {
      const fault = out?.Fault?.Error?.[0];
      const detail = fault
        ? `${fault.code ?? "?"} ${fault.Message ?? ""} ${fault.Detail ?? ""}`.slice(0, 700)
        : JSON.stringify(out).slice(0, 700);
      await db.from("qb_push_log").insert({
        job_week_id: jobWeekId, action: "push_invoice", status: "error",
        amount: linesTotal || null, detail, intuit_tid: tid, http_status: res.status,
      });

      // 6140 is QuickBooks saying that invoice number is already on its books.
      // Worth saying plainly, because the fix is to change the number, not retry.
      const duplicate = String(fault?.code ?? "") === "6140";
      return json({
        ok: false,
        error: duplicate
          ? `QuickBooks already has an invoice numbered ${docNumber}. Change the number on this one and push again.`
          : "QuickBooks rejected the invoice",
        duplicate_number: duplicate ? docNumber : null,
        quickbooks_message: fault?.Message ?? null,
        quickbooks_detail: fault?.Detail ?? null,
        quickbooks_code: fault?.code ?? null,
        intuit_tid: tid,
        http_status: res.status,
        note: "Nothing was created. Quote the intuit_tid above if you contact Intuit support.",
      }, 502);
    }

    const inv = out.Invoice;

    // QuickBooks has the final say on the number. If it assigned something other
    // than what we proposed, the portal takes its answer.
    const assigned = inv.DocNumber ? String(inv.DocNumber) : null;
    const update: Record<string, unknown> = {
      qb_invoice_id: String(inv.Id),
      qb_invoice_total: Number(inv.TotalAmt),
      qb_pushed_at: new Date().toISOString(),
      status: "synced",
    };
    if (assigned && assigned !== payload.invoice_no) update.invoice_no = assigned;
    await db.from(table).update(update).eq("id", rowId);

    await db.from("qb_push_log").insert({
      job_week_id: jobWeekId, action: "push_invoice", status: "sent",
      qb_invoice_id: String(inv.Id), amount: Number(inv.TotalAmt),
      intuit_tid: tid, http_status: res.status,
      detail: `${isParts ? "Parts cut" : payload.job_name} -> ${payload.customer_name} as invoice ${assigned ?? "(unnumbered)"} by ${me?.full_name ?? who.user.email}`.slice(0, 780),
    });

    // ---- the crew sheet -----------------------------------------------------
    // Everything below is best effort. The invoice is already on their books.
    // A week, and only a week. Parts and desk invoices have no hours behind
    // them, so there is nothing to draw and nothing missing when none appears.
    // Testing !isParts was right when there were two kinds and quietly wrong the
    // moment there were three -- a desk invoice would have been told its crew
    // sheet failed to attach.
    let backup: Record<string, unknown> = { attached: false };
    if (kind === "week" && jobWeekId) {
      const sheet = await buildBackupForJobWeek(db as never, jobWeekId);
      if (!sheet.ok) {
        backup = { attached: false, error: sheet.error };
      } else {
        const att = await attachToInvoice({
          apiBase: API_BASE(t.environment), realmId: t.realm_id, accessToken: t.access_token,
          invoiceId: String(inv.Id), pdf: sheet.pdf, filename: sheet.filename,
        });
        backup = att.ok
          ? { attached: true, filename: sheet.filename, attachable_id: att.attachable_id }
          : { attached: false, filename: sheet.filename, error: att.error };
      }
      if (!backup.attached) {
        await db.from("qb_push_log").insert({
          job_week_id: jobWeekId, action: "attach_backup", status: "error",
          qb_invoice_id: String(inv.Id), intuit_tid: null,
          detail: String(backup.error ?? "unknown").slice(0, 780),
        });
      }
    }

    return json({
      ok: true,
      qb_invoice_id: String(inv.Id),
      doc_number: assigned,
      backup,
      proposed_number: payload.invoice_no ?? null,
      number_changed_by_quickbooks: Boolean(assigned && assigned !== payload.invoice_no),
      total: Number(inv.TotalAmt),
      copied_to: (billTo.BillEmailCc as { Address?: string } | undefined)?.Address ?? null,
      customer: payload.customer_name,
      job: payload.job_name,
      emailed: inv.EmailStatus ?? "NotSet",
      intuit_tid: tid,
      note: "Created in QuickBooks and not sent. Review it there before sending."
        + (kind !== "week" ? "" : (backup.attached
            ? " The crew sheet is attached to it and will go out with it."
            : " The crew sheet could not be attached -- the invoice is fine; open the sheet from Approvals.")),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    try {
      await db.from("qb_push_log").insert({
        job_week_id: jobWeekId, action: "push_invoice", status: "error", detail: msg.slice(0, 800),
      });
    } catch { /* best effort */ }
    return json({ ok: false, error: msg }, 500);
  }
});
