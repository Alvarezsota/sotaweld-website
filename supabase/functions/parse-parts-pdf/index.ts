// Reads a PDF dropped on the Parts Invoice page and hands back the lines.
//
// The office gets the same job described three different ways: a quote this
// portal printed, a purchase order on the customer's own letterhead, and a cut
// list out of the laser software. All three already say what is being billed
// and for how much, and all three were being retyped by hand.
//
// So the PDF goes to Claude and comes back as lines. Not text scraped out of it
// first -- the PDF itself, which is the difference between reading a table and
// reading the words of a table in the order they happen to be stored. It also
// means a scanned purchase order that somebody photographed still works, where
// text extraction would have returned nothing at all.
//
// WHAT THIS DOES NOT DO
//
// It does not save anything. It fills the form in and stops. Every number it
// pulled is sitting in a box the office can change before the invoice is
// finished, because a machine reading somebody else's paperwork is going to be
// wrong sometimes and the wrong place to find that out is on a customer's bill.
//
// It does not guess at prices either. If a document has no price on it -- a cut
// list usually does not -- the line comes back at zero and stays zero rather
// than being filled in from anywhere, because a plausible invented price is far
// worse than an obvious blank one.
//
// Admin only, same as the push: reading a customer's paperwork and drafting a
// bill from it is not something a welder's login should do.

import { createClient } from "jsr:@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk@0.122.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
// Anthropic's current console issues "identity-linked" keys -- tied to the
// person rather than to a workspace -- and those refuse any request that does
// not say which workspace it is acting in. Older workspace keys carry that
// implicitly and do not need this. Set when the key is the identity-linked
// kind; left unset otherwise and nothing is sent.
const ANTHROPIC_WORKSPACE_ID = Deno.env.get("ANTHROPIC_WORKSPACE_ID") ?? "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPPORT = "State of the Arc office - (432) 248-1455 - g.alvarez@sotaweld.com";

// 12 MB of PDF. Intuit is not involved here; the limit is Anthropic's 32 MB
// request, and base64 costs a third on top of the file. Anything bigger than
// this is not a parts invoice, it is a drawing set.
const MAX_PDF_BYTES = 12 * 1024 * 1024;

/* The shape the page knows how to fill in. Every field is nullable on purpose:
   a cut list has no customer and no prices, a purchase order has no line
   totals, and "not on the document" has to be expressible or the model will
   invent something to fill the hole. */
const SCHEMA = {
  type: "object",
  properties: {
    customer_name: {
      type: ["string", "null"],
      description:
        "Who is being billed. On a purchase order that is the company that ISSUED it, not us -- State of the Arc Welding and Services is the seller and must never be returned here. Null if the document does not name a buyer.",
    },
    document_date: {
      type: ["string", "null"],
      description: "The date on the document as YYYY-MM-DD. Null if there is none.",
    },
    po_number: {
      type: ["string", "null"],
      description:
        "The customer's purchase order or job number, if the document carries one. Not our own quote or invoice number.",
    },
    notes: {
      type: ["string", "null"],
      description:
        "One short line naming the job or the part, if the document says. Not a summary of the whole document.",
    },
    lines: {
      type: "array",
      description:
        "One entry per billable line. Skip subtotals, tax, shipping, totals and anything that is not a thing being sold.",
      items: {
        type: "object",
        properties: {
          description: {
            type: "string",
            description:
              "What the line is for, as the document words it -- material, size and part name where it gives them.",
          },
          quantity: { type: "number", description: "How many. 1 if the document does not say." },
          unit_price: {
            type: "number",
            description:
              "Price for ONE of them. If the document shows only a line total, divide it by the quantity. If the document shows no price at all, return 0 -- never estimate one.",
          },
        },
        required: ["description", "quantity", "unit_price"],
        additionalProperties: false,
      },
    },
  },
  required: ["customer_name", "document_date", "po_number", "notes", "lines"],
  additionalProperties: false,
};

const SYSTEM = [
  "You read a document and report what is billable on it. You are working for",
  "State of the Arc Welding and Services LLC, a welding and fabrication shop in",
  "Odessa, Texas, who are the SELLER. The document may be a quote they wrote, a",
  "purchase order a customer sent them, or a cut list out of their laser software.",
  "",
  "Report only what the document actually says. Every figure you return has to be",
  "readable on the page in front of you. Where the document is silent, say so with",
  "null or 0 -- a blank the office fills in themselves costs them ten seconds, and",
  "a number you invented costs them an argument with a customer.",
].join("\n");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const json = (b: Record<string, unknown>, status = 200) =>
    new Response(JSON.stringify({ ...b, support: SUPPORT }, null, 2),
      { status, headers: { ...CORS, "Content-Type": "application/json" } });

  try {
    if (!ANTHROPIC_API_KEY) {
      return json({
        ok: false,
        error: "Reading PDFs is not switched on yet.",
        detail:
          "ANTHROPIC_API_KEY has not been set on this project, so there is nothing to send the PDF to. "
          + "Add it under Edge Functions -> Secrets in Supabase and this will start working; nothing else needs changing.",
      }, 503);
    }

    const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const auth = req.headers.get("Authorization") ?? "";
    const asCaller = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: auth } } });
    const { data: who } = await asCaller.auth.getUser();
    if (!who?.user) return json({ ok: false, error: "not signed in" }, 401);
    const { data: me } = await db.from("profiles").select("role").eq("id", who.user.id).maybeSingle();
    if (me?.role !== "admin") return json({ ok: false, error: "admins only" }, 403);

    const body = await req.json().catch(() => ({}));
    const b64 = String(body.pdf_base64 ?? "");
    const filename = String(body.filename ?? "the file");
    if (!b64) return json({ ok: false, error: "no PDF arrived" }, 400);

    // base64 is 4 characters for every 3 bytes.
    const approxBytes = Math.floor(b64.length * 3 / 4);
    if (approxBytes > MAX_PDF_BYTES) {
      return json({
        ok: false,
        error: `${filename} is too big to read (${(approxBytes / 1024 / 1024).toFixed(1)} MB). The limit is 12 MB.`,
      }, 413);
    }

    const client = new Anthropic({
      apiKey: ANTHROPIC_API_KEY,
      ...(ANTHROPIC_WORKSPACE_ID
        ? { defaultHeaders: { "anthropic-workspace-id": ANTHROPIC_WORKSPACE_ID } }
        : {}),
    });

    const res = await client.beta.messages.create({
      model: "claude-opus-5",
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: SYSTEM,
      // Low effort: this is reading a page, not solving anything. It keeps the
      // cost per PDF down around a penny and the wait down to a few seconds.
      output_config: {
        effort: "low",
        format: { type: "json_schema", schema: SCHEMA },
      },
      messages: [{
        role: "user",
        content: [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } },
          { type: "text", text: `This is ${filename}. Report what is billable on it.` },
        ],
      }],
    });

    if (res.stop_reason === "refusal") {
      return json({
        ok: false,
        error: "That document could not be read.",
        detail: res.stop_details?.explanation ?? null,
      }, 422);
    }

    const text = (res.content ?? [])
      .filter((b: { type: string }) => b.type === "text")
      .map((b: { text: string }) => b.text).join("");

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(text);
    } catch {
      return json({ ok: false, error: "Nothing readable came back from that PDF.",
                    detail: text.slice(0, 400) }, 502);
    }

    // Belt and braces on the numbers. The schema asks for numbers and gets
    // them, but this form ends up on a customer's invoice, and NaN in a price
    // box is a worse afternoon than a zero.
    const lines = Array.isArray(parsed.lines) ? parsed.lines : [];
    const clean = lines.map((l: Record<string, unknown>) => ({
      description: String(l.description ?? "").slice(0, 500),
      quantity: Number.isFinite(Number(l.quantity)) ? Number(l.quantity) : 1,
      unit_price: Number.isFinite(Number(l.unit_price)) ? Number(l.unit_price) : 0,
    })).filter((l) => l.description.trim());

    return json({
      ok: true,
      filename,
      customer_name: parsed.customer_name ?? null,
      document_date: parsed.document_date ?? null,
      po_number: parsed.po_number ?? null,
      notes: parsed.notes ?? null,
      lines: clean,
      usage: { input_tokens: res.usage?.input_tokens, output_tokens: res.usage?.output_tokens },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);

    // The one failure whose fix is a setting rather than a bug. Worth naming,
    // because Anthropic's own wording ("send the id of the workspace this
    // request acts in") tells you nothing about where that id lives.
    if (/anthropic-workspace-id/i.test(msg) && !ANTHROPIC_WORKSPACE_ID) {
      return json({
        ok: false,
        error: "That key needs to be told which workspace to use.",
        detail:
          "Anthropic issued an identity-linked key, which will not run without a workspace id. "
          + "In the Anthropic console open Settings -> Workspaces, click your workspace, and copy its "
          + "id (it starts with wrkspc_). Add it in Supabase as a second secret named "
          + "ANTHROPIC_WORKSPACE_ID, then try the PDF again.",
      }, 503);
    }

    return json({ ok: false, error: "That PDF could not be read: " + msg }, 500);
  }
});
