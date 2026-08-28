// The customer list behind the invoice pickers: refreshing it from QuickBooks,
// and adding a customer to QuickBooks without leaving the portal.
//
// Admin-only, same as the push. A welder has no business creating customers.
//
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// ---------------------------------------------------------------------------
//
// The parts invoice screen could only ever offer the customers that happened to
// be in the table the day it was filled. New plate work walks in from somebody
// who has never been billed before, and the only way to invoice them was to go
// into QuickBooks, make the customer there, and come back -- assuming you knew
// that was what the empty dropdown was telling you.
//
// Three actions, each of which ends with the local table matching QuickBooks:
//
//   sync    - pull every customer down. Cheap, and the answer to "I made them in
//             QuickBooks and they are not in the list".
//   create  - make one in QuickBooks and keep the id it hands back. The id is
//             the whole point: an invoice references a customer by id, so a name
//             typed into the portal that does not exist over there is worthless.
//   update  - correct one that is already there. Sparse, so the boxes this
//             screen does not show are never wiped by leaving them empty.
//
// QuickBooks decides whether a name is allowed. DisplayName has to be unique on
// their side, so a duplicate comes back as their error and is passed through in
// their words rather than guessed at here.

import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const CLIENT_ID = Deno.env.get("QB_CLIENT_ID") ?? "";
const CLIENT_SECRET = Deno.env.get("QB_CLIENT_SECRET") ?? "";

const FALLBACK_TOKEN = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
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

  const res = await fetchWithRetry(cfg?.token_endpoint ?? FALLBACK_TOKEN, {
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
      `If the connection has expired, reconnect the portal to QuickBooks.`);
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

/** The shape the portal keeps for one QuickBooks customer. */
function localRow(c: Record<string, any>, environment: string) {
  const parent = c.ParentRef?.value ? String(c.ParentRef.value) : null;
  return {
    id: String(c.Id),
    environment,
    display_name: String(c.DisplayName ?? "").trim(),
    company_name: c.CompanyName ? String(c.CompanyName).trim() : null,
    // A customer can hang under another one -- a job site or a project, billed
    // with its parent. Flattening that is what made RedHills Pipeline look like
    // a company of its own in the picker.
    parent_id: parent,
    is_sub_customer: Boolean(parent),
    fully_qualified_name: String(c.FullyQualifiedName ?? c.DisplayName ?? "").trim() || null,
    active: c.Active !== false,
    synced_at: new Date().toISOString(),
  };
}

/** Reads one customer, for its SyncToken -- QuickBooks' own concurrency check,
 *  which has to be echoed back on any write or the write is refused. */
async function readCustomer(base: string, headers: HeadersInit, id: string) {
  const res = await fetchWithRetry(
    `${base}/customer/${encodeURIComponent(id)}?minorversion=75`, { headers });
  const out = await res.json().catch(() => ({}));
  return { ok: res.ok && Boolean(out?.Customer?.Id), out, tid: res.headers.get("intuit_tid") };
}

/** Intuit's own words when they refuse, rather than a guess at what went wrong. */
function faultOf(out: Record<string, any>) {
  const f = out?.Fault?.Error?.[0];
  if (!f) return null;
  return {
    code: f.code ?? null,
    message: f.Message ?? null,
    detail: f.Detail ?? null,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const json = (b: Record<string, unknown>, status = 200) =>
    new Response(JSON.stringify({ ...b, support: SUPPORT }, null, 2),
      { status, headers: { ...CORS, "Content-Type": "application/json" } });

  try {
    const auth = req.headers.get("Authorization") ?? "";
    const asCaller = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: auth } } });
    const { data: who } = await asCaller.auth.getUser();
    if (!who?.user) return json({ ok: false, error: "not signed in" }, 401);
    const { data: me } = await db.from("profiles").select("role").eq("id", who.user.id).maybeSingle();
    if (me?.role !== "admin") return json({ ok: false, error: "admins only" }, 403);

    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? "sync");

    const t = await liveToken(db);
    const base = `${API_BASE(t.environment)}/v3/company/${t.realm_id}`;
    const headers = {
      Authorization: `Bearer ${t.access_token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    };

    /* ---------------------------------------------------------------- sync */
    if (action === "sync") {
      // QuickBooks pages at 1000 and gives no total, so keep asking until a page
      // comes back short. Inactive customers come down too -- the picker filters
      // them, but a name that went inactive should stop being offered rather
      // than linger because nothing ever told us.
      const rows: Record<string, unknown>[] = [];
      let start = 1;
      for (let page = 0; page < 12; page++) {
        const q = `select * from Customer startposition ${start} maxresults 1000`;
        const res = await fetchWithRetry(
          `${base}/query?query=${encodeURIComponent(q)}&minorversion=75`, { headers });
        const out = await res.json().catch(() => ({}));
        if (!res.ok) {
          return json({
            ok: false, error: "QuickBooks would not give up the customer list",
            quickbooks: faultOf(out), intuit_tid: res.headers.get("intuit_tid"),
          }, 502);
        }
        const batch: Record<string, any>[] = out?.QueryResponse?.Customer ?? [];
        rows.push(...batch.map((c) => localRow(c, t.environment)));
        if (batch.length < 1000) break;
        start += batch.length;
      }

      if (rows.length) {
        const { error } = await db.from("qb_customers").upsert(rows, { onConflict: "id,environment" });
        if (error) throw new Error(`could not save the customer list: ${error.message}`);
      }
      return json({ ok: true, action, environment: t.environment, customers: rows.length });
    }

    /* -------------------------------------------------------------- create */
    if (action === "create") {
      const name = String(body.display_name ?? "").trim();
      if (!name) return json({ ok: false, error: "a customer needs a name" }, 400);

      const email = String(body.email ?? "").trim();
      const emailCc = String(body.email_cc ?? "").trim();
      const company = String(body.company_name ?? "").trim();
      const phone = String(body.phone ?? "").trim();

      const qbCustomer: Record<string, unknown> = {
        DisplayName: name.slice(0, 100),
        ...(company ? { CompanyName: company.slice(0, 100) } : {}),
        ...(email ? { PrimaryEmailAddr: { Address: email.slice(0, 100) } } : {}),
        ...(phone ? { PrimaryPhone: { FreeFormNumber: phone.slice(0, 30) } } : {}),
      };

      const res = await fetchWithRetry(`${base}/customer?minorversion=75`, {
        method: "POST", headers, body: JSON.stringify(qbCustomer),
      });
      const tid = res.headers.get("intuit_tid");
      const out = await res.json().catch(() => ({}));

      if (!res.ok || !out?.Customer?.Id) {
        const fault = faultOf(out);
        // 6240 is the name already being on their books. Worth saying plainly,
        // because the fix is to pick the existing one, not to try again.
        const duplicate = String(fault?.code ?? "") === "6240";
        return json({
          ok: false,
          error: duplicate
            ? `QuickBooks already has a customer called "${name}". Refresh the list and pick that one.`
            : "QuickBooks would not create that customer",
          duplicate_name: duplicate ? name : null,
          quickbooks: fault, intuit_tid: tid,
          note: "Nothing was created.",
        }, duplicate ? 409 : 502);
      }

      const row = {
        ...localRow(out.Customer, t.environment),
        // Carbon copies have nowhere to live on the QuickBooks customer record,
        // so the portal keeps them and the push sets them on each invoice.
        ...(emailCc ? { bill_email_cc: emailCc.slice(0, 200) } : {}),
        ...(email ? { bill_email: email.slice(0, 100) } : {}),
      };
      const { error } = await db.from("qb_customers").upsert(row, { onConflict: "id,environment" });
      if (error) throw new Error(`created in QuickBooks but could not be saved here: ${error.message}`);

      return json({ ok: true, action, customer: row, intuit_tid: tid });
    }

    /* -------------------------------------------------------------- update */
    // Correcting a customer already on the books. Name, company and email
    // belong to QuickBooks and are written there; carbon copies have nowhere to
    // live over there and stay local.
    //
    // Renaming reaches further than it looks: QuickBooks shows the current name
    // on every invoice ever raised against that customer, including ones long
    // since sent. That is their behaviour, not something to work around here,
    // but it is why the screen says so before the button is pressed.
    if (action === "update") {
      const id = String(body.id ?? "").trim();
      if (!id) return json({ ok: false, error: "which customer?" }, 400);

      const name = String(body.display_name ?? "").trim();
      const company = String(body.company_name ?? "").trim();
      const email = String(body.email ?? "").trim();
      const emailCc = String(body.email_cc ?? "").trim();
      const phone = String(body.phone ?? "").trim();

      // Anything QuickBooks holds. Carbon copies alone need no round trip.
      const wantsRemote = Boolean(name || company || email || phone);
      let saved: Record<string, any> | null = null;

      if (wantsRemote) {
        const cur = await readCustomer(base, headers, id);
        if (!cur.ok) {
          return json({
            ok: false, error: "QuickBooks does not have that customer",
            quickbooks: faultOf(cur.out), intuit_tid: cur.tid,
          }, 502);
        }

        // Sparse, so a blank box here never wipes something over there that this
        // screen does not even show -- terms, addresses, tax code.
        const patch: Record<string, unknown> = {
          Id: cur.out.Customer.Id, SyncToken: cur.out.Customer.SyncToken, sparse: true,
          ...(name ? { DisplayName: name.slice(0, 100) } : {}),
          ...(company ? { CompanyName: company.slice(0, 100) } : {}),
          ...(email ? { PrimaryEmailAddr: { Address: email.slice(0, 100) } } : {}),
          ...(phone ? { PrimaryPhone: { FreeFormNumber: phone.slice(0, 30) } } : {}),
        };

        const res = await fetchWithRetry(`${base}/customer?minorversion=75`, {
          method: "POST", headers, body: JSON.stringify(patch),
        });
        const tid = res.headers.get("intuit_tid");
        const out = await res.json().catch(() => ({}));
        if (!res.ok || !out?.Customer?.Id) {
          const fault = faultOf(out);
          const duplicate = String(fault?.code ?? "") === "6240";
          return json({
            ok: false,
            error: duplicate
              ? `QuickBooks already has a customer called "${name}". Pick a different name.`
              : "QuickBooks would not take that change",
            duplicate_name: duplicate ? name : null,
            quickbooks: fault, intuit_tid: tid,
            note: "Nothing was changed.",
          }, duplicate ? 409 : 502);
        }
        saved = out.Customer;
      }

      // An empty box clears the stored address rather than being ignored, so
      // there is a way to take one back off. QuickBooks keeps its own.
      const row: Record<string, unknown> = {
        bill_email: email ? email.slice(0, 100) : null,
        bill_email_cc: emailCc ? emailCc.slice(0, 200) : null,
        ...(saved ? localRow(saved, t.environment) : {}),
      };
      const { error } = await db.from("qb_customers")
        .update(row).eq("id", id).eq("environment", t.environment);
      if (error) throw new Error(`saved in QuickBooks but not here: ${error.message}`);

      const { data: after } = await db.from("qb_customers")
        .select("*").eq("id", id).eq("environment", t.environment).maybeSingle();
      return json({ ok: true, action, customer: after });
    }

    return json({ ok: false, error: `unknown action "${action}"` }, 400);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return json({ ok: false, error: msg }, 500);
  }
});
