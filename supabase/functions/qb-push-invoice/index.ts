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
// TWO KINDS OF INVOICE, ONE PUSH
// ---------------------------------------------------------------------------
//
// A job week is a week of labour that has been approved. A parts invoice is
// plate that went on the laser and came off as parts, with no week and nobody's
// hours behind it. They are different things and they are billed the same way,
// so both build a payload of the same shape in Postgres and everything from
// there down -- the refusals, the token, the number, the write-back -- is one
// piece of code. Pass job_week_id or parts_invoice_id; the rest does not care
// which arrived.
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
    jobWeekId = body.job_week_id ?? null;
    const partsInvoiceId: string | null = body.parts_invoice_id ?? null;
    const dryRun = Boolean(body.dryRun);
    const forceBad = Boolean(body.__testBadRequest);
    if (!jobWeekId && !partsInvoiceId) {
      return json({ ok: false, error: "job_week_id or parts_invoice_id is required" }, 400);
    }
    if (jobWeekId && partsInvoiceId) {
      return json({ ok: false, error: "pass one of job_week_id or parts_invoice_id, not both" }, 400);
    }
    const isParts = Boolean(partsInvoiceId);

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

    const table = isParts ? "parts_invoices" : "job_weeks";
    const rowId = isParts ? partsInvoiceId : jobWeekId;
    const { data: row } = await db.from(table)
      .select("id, status, qb_invoice_id, invoice_no").eq("id", rowId).maybeSingle();
    if (!row) return json({ ok: false, error: `${isParts ? "invoice" : "job week"} not found` }, 404);

    if (row.qb_invoice_id) {
      blockers.push({
        code: "already_pushed",
        message: `${isParts ? "This invoice is" : "This week is"} already on QuickBooks invoice ${row.qb_invoice_id}. Nothing would be created.`,
      });
    }
    // A week is ready when it has been approved; a parts invoice when it has
    // been marked finished. Same idea, different word on each screen.
    const readyStatus = isParts ? "ready" : "approved";
    if (row.status !== readyStatus && row.status !== "synced") {
      blockers.push({
        code: "not_approved",
        message: isParts
          ? `This invoice is still a draft. Mark it finished before it can be sent.`
          : `This week is "${row.status}". Approve it before it can be invoiced.`,
      });
    }

    const { data: payload, error: pErr } = isParts
      ? await db.rpc("parts_invoice_payload", { p_invoice_id: partsInvoiceId })
      : await db.rpc("qb_invoice_payload", { p_job_week_id: jobWeekId });
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

    // Where this invoice gets emailed. QuickBooks holds one address on the
    // customer record and has nowhere to keep carbon copies, so the CC list has
    // to ride on the invoice itself or the send window comes up with a blank Cc.
    const env = String(ready?.connected_environment ?? "production");
    const custId = String((payload.customer as { id?: string } | undefined)?.id ?? "");
    let billTo = "", billCc = "";
    if (custId) {
      const { data: cust } = await db.from("qb_customers")
        .select("bill_email, bill_email_cc")
        .eq("id", custId).eq("environment", env).maybeSingle();
      billTo = (cust?.bill_email ?? "").trim();
      billCc = (cust?.bill_email_cc ?? "").trim();
    }

    // A preview never refuses and never touches QuickBooks. It draws the invoice
    // and hands back whatever would stand in the way of sending it.
    if (dryRun) {
      return json({
        ok: true, dryRun: true, payload, blockers, readiness: ready,
        emailTo: billTo || null, emailCc: billCc || null,
      });
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
        detail: (isParts ? `parts invoice ${partsInvoiceId}: ` : "") +
          blockers.map((b) => `${b.code}: ${b.message}`).join(" | ").slice(0, 780),
      });
      return json({ ok: false, error: first.message, blockers }, 409);
    }

    const t = await liveToken(db);

    // The number the portal proposes. Left off entirely when there is none, so
    // QuickBooks assigns its own rather than being handed a blank.
    const docNumber = payload.invoice_no ? String(payload.invoice_no).slice(0, 21) : null;

    const qbInvoice = forceBad
      ? { Line: [{ Amount: "not-a-number", DetailType: "SalesItemLineDetail", SalesItemLineDetail: {} }] }
      : {
        CustomerRef: { value: payload.customer.id },
        TxnDate: payload.transaction_date,
        // Only sent when we hold an address. Left off, QuickBooks keeps whatever
        // is already on the customer rather than being handed a blank.
        ...(billTo ? { BillEmail: { Address: billTo.slice(0, 100) } } : {}),
        ...(billCc ? { BillEmailCc: { Address: billCc.slice(0, 200) } } : {}),
        PrivateNote: payload.memo,
        ...(docNumber ? { DocNumber: docNumber } : {}),
        // A PO number is what the customer's own accounts department matches
        // against, so it goes where QuickBooks prints it rather than into a memo.
        ...(payload.po_number ? { CustomerMemo: { value: `PO ${payload.po_number}` } } : {}),
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
      detail: `${isParts ? "Parts cut" : payload.job_name} -> ${payload.customer_name} as invoice ${assigned ?? "(unnumbered)"} by ${me?.full_name ?? who.user.email}`,
    });

    return json({
      ok: true,
      qb_invoice_id: String(inv.Id),
      doc_number: assigned,
      proposed_number: payload.invoice_no ?? null,
      number_changed_by_quickbooks: Boolean(assigned && assigned !== payload.invoice_no),
      total: Number(inv.TotalAmt),
      customer: payload.customer_name,
      job: payload.job_name,
      emailed: inv.EmailStatus ?? "NotSet",
      intuit_tid: tid,
      emailTo: billTo || null,
      emailCc: billCc || null,
      note: "Created in QuickBooks and not sent. Review it there before sending.",
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
