// The daily weld log, sent one email per customer.
//
// It used to be a single email covering everyone's inches across every job. That
// is the wrong shape for what it is actually used for: the office forwards this
// to the customer, and a log covering Rocking Double S and BT Constructors in one
// document cannot be forwarded to either of them without editing it first.
//
// So the day is split by who gets billed - jobs.bill_to - and each customer gets
// its own email, its own subject line and its own PDF. Forwarding one is now the
// whole job rather than the start of one.
//
// A welder who worked two customers in a day appears in both, with only that
// customer's inches under his name. His hours are the day's hours and are shown
// as such, because a man's hours are not divisible by customer here.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { PDFDocument, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const DEFAULT_ALERT_EMAIL = "g.alvarez@sotaweld.com";

// Work with no customer behind it still has to go somewhere, or it would vanish
// out of the day's total with nobody noticing.
const NO_CUSTOMER = "Unassigned";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function chicagoDateString(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

type Welder = { name: string; total: number; hours: number | null; helper: string | null; rows: any[] };

async function buildPdf(customer: string, dateLabel: string, grandTotal: number, welders: Welder[], jobNameFor: (r: any) => string, gaps: string[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const pageW = 612, pageH = 792, margin = 50;
  let page = doc.addPage([pageW, pageH]);
  let y = pageH - margin;

  function newPageIfNeeded(need: number) {
    if (y - need < margin) {
      page = doc.addPage([pageW, pageH]);
      y = pageH - margin;
    }
  }
  function text(str: string, x: number, size: number, f = font, color = rgb(0.1, 0.1, 0.1)) {
    page.drawText(str, { x, y, size, font: f, color });
  }
  function wrapText(str: string, maxWidth: number, size: number, f = font): string[] {
    const words = str.split(" ");
    const lines: string[] = [];
    let line = "";
    for (const w of words) {
      const trial = line ? line + " " + w : w;
      if (f.widthOfTextAtSize(trial, size) > maxWidth && line) { lines.push(line); line = w; }
      else { line = trial; }
    }
    if (line) lines.push(line);
    return lines;
  }

  text("Daily Weld Inch Summary", margin, 18, bold, rgb(0, 0, 0));
  y -= 22;
  // The customer's name sits directly under the title, so a forwarded copy says
  // whose log it is on its face rather than only in the email it arrived in.
  text(customer, margin, 13, bold, rgb(0.13, 0.3, 0.55));
  y -= 18;
  text(dateLabel, margin, 11, font, rgb(0.4, 0.4, 0.4));
  y -= 26;
  text(`${grandTotal.toFixed(2)} in total  ·  ${welders.length} welder${welders.length === 1 ? "" : "s"} reported`, margin, 14, bold, rgb(0.13, 0.5, 0.25));
  y -= 26;

  if (gaps.length) {
    newPageIfNeeded(20 + gaps.length * 13);
    text("Data gaps to check", margin, 12, bold, rgb(0.75, 0.2, 0.2));
    y -= 16;
    for (const g of gaps) {
      for (const line of wrapText(g, pageW - margin * 2 - 14, 10)) {
        newPageIfNeeded(13);
        text(line, margin + 14, 10, font, rgb(0.6, 0.25, 0.2));
        y -= 13;
      }
    }
    y -= 14;
  }

  for (const w of welders) {
    newPageIfNeeded(40);
    text(w.name, margin, 13, bold, rgb(0, 0, 0));
    if (w.helper) {
      const withLabel = `with ${w.helper}`;
      const startX = margin + bold.widthOfTextAtSize(w.name, 13) + 8;
      if (startX + font.widthOfTextAtSize(withLabel, 10) < pageW - margin - 170) {
        text(withLabel, startX, 10, font, rgb(0.35, 0.35, 0.35));
      }
    }
    const hoursLabel = w.hours != null ? `${w.hours} hrs logged` : "no hours logged";
    const hoursColor = w.hours != null ? rgb(0.45, 0.45, 0.45) : rgb(0.75, 0.2, 0.2);
    text(hoursLabel, pageW - margin - 160, 10, font, hoursColor);
    text(`${w.total.toFixed(2)} in`, pageW - margin - 70, 13, bold, rgb(0.13, 0.5, 0.25));
    y -= 18;

    for (const r of w.rows) {
      newPageIfNeeded(16);
      text(`${jobNameFor(r)}`, margin + 14, 11, bold, rgb(0.2, 0.2, 0.2));
      text(`${Number(r.total_inches).toFixed(2)} in`, pageW - margin - 70, 11, font, rgb(0.13, 0.5, 0.25));
      y -= 14;

      const breakdown = (r.breakdown || []) as { label: string; qty: number; total: number }[];
      const misc = (r.misc_items || []) as { description: string; inches: number }[];
      for (const b of breakdown) {
        newPageIfNeeded(13);
        text(`${b.label} x ${b.qty} = ${b.total} in`, margin + 28, 9, font, rgb(0.45, 0.45, 0.45));
        y -= 12;
      }
      for (const m of misc) {
        newPageIfNeeded(13);
        text(`MISC: ${m.description}${m.inches ? " = " + m.inches + " in" : ""}`, margin + 28, 9, font, rgb(0.45, 0.45, 0.45));
        y -= 12;
      }
    }
    y -= 12;
  }

  return doc.save();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  try {
    let body: any = {};
    try { body = await req.json(); } catch { body = {}; }

    let targetDate: string;
    let toEmail = DEFAULT_ALERT_EMAIL;
    let ccList: string[] = [];

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    if (body.date || body.to) {
      // Two ways to ask for a particular day: an admin's token from the portal,
      // or the shared hook secret, which is how the database re-sends a day that
      // needs doing again. Without the second, re-running a specific date meant
      // having a browser session to hand.
      const secret = req.headers.get("x-sota-secret");
      let allowed = false;
      if (secret) {
        const { data: row } = await supabase.from("app_settings").select("value").eq("key", "summary_hook_secret").maybeSingle();
        allowed = !!row?.value && secret === row.value;
        if (!allowed) {
          return new Response(JSON.stringify({ ok: false, error: "Bad secret" }), { status: 403, headers: CORS_HEADERS });
        }
      } else {
        const authHeader = req.headers.get("Authorization") || "";
        const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
          global: { headers: { Authorization: authHeader } },
        });
        const { data: userData } = await callerClient.auth.getUser();
        if (!userData?.user) {
          return new Response(JSON.stringify({ ok: false, error: "Not authenticated" }), { status: 401, headers: CORS_HEADERS });
        }
        const { data: profile } = await supabase.from("profiles").select("role").eq("id", userData.user.id).maybeSingle();
        if (!profile || profile.role !== "admin") {
          return new Response(JSON.stringify({ ok: false, error: "Admins only" }), { status: 403, headers: CORS_HEADERS });
        }
      }
      targetDate = body.date || chicagoDateString(new Date());
      toEmail = body.to || DEFAULT_ALERT_EMAIL;
      if (Array.isArray(body.cc)) ccList = body.cc.map((s: string) => s.trim()).filter(Boolean);
      else if (typeof body.cc === "string") ccList = body.cc.split(",").map((s: string) => s.trim()).filter(Boolean);
    } else {
      const now = new Date();
      const todayChicago = chicagoDateString(now);
      const [y, m, d] = todayChicago.split("-").map(Number);
      const yesterday = new Date(Date.UTC(y, m - 1, d - 1));
      targetDate = yesterday.toISOString().slice(0, 10);
    }

    const [{ data: reports, error }, { data: jobs, error: jobsError }, { data: entries, error: entriesError }, { data: helpers }] = await Promise.all([
      supabase
        .from("weld_reports")
        .select("*, profiles!weld_reports_welder_id_fkey(full_name)")
        .eq("report_date", targetDate)
        .order("total_inches", { ascending: false }),
      supabase.from("jobs").select("id, name, is_yard, bill_to"),
      supabase.from("daily_entries").select("id, welder_id, hours").eq("entry_date", targetDate),
      supabase.from("helpers_public").select("id, name"),
    ]);

    if (error) throw error;
    if (jobsError) throw jobsError;
    if (entriesError) throw entriesError;

    if (!reports || reports.length === 0) {
      return new Response(JSON.stringify({ ok: true, skipped: true, reason: "no reports for " + targetDate }), { status: 200, headers: CORS_HEADERS });
    }

    const jobsById: Record<string, { id: string; name: string; is_yard: boolean; bill_to: string | null }> = {};
    (jobs || []).forEach((j) => { jobsById[j.id] = j; });

    const helperNameById: Record<string, string> = {};
    (helpers || []).forEach((h: { id: string; name: string }) => { helperNameById[h.id] = h.name; });

    const hoursByWelder: Record<string, number> = {};
    const welderByEntryId: Record<string, string> = {};
    (entries || []).forEach((e) => {
      hoursByWelder[e.welder_id] = (hoursByWelder[e.welder_id] || 0) + Number(e.hours);
      welderByEntryId[e.id] = e.welder_id;
    });

    // Who was with him, taken off the hours ticket as well as off the weld report.
    //
    // The weld report has its own helper question, and it is the welder's own
    // answer, so it wins. But it is answered from a list loaded when the page was
    // opened: a helper added to the system after that is not on it, and the man
    // has nothing to pick. The report then says nobody, while the hours ticket -
    // filed later, from a fresh list - names him and pays him.
    //
    // That is exactly how Damian Silva and Juan Calleros came to read "worked
    // alone" on 2026-08-24 with Alexander Fuentes and Alvaro Esquivel on their
    // tickets. So when the report is silent, ask the ticket. A helper who was paid
    // for the day was there, whatever the report managed to record, and this picks
    // up newly added helpers with nothing to remember to do.
    const ticketHelpersByWelder: Record<string, string[]> = {};
    const entryIds = (entries || []).map((e) => e.id);
    if (entryIds.length) {
      const { data: helperRows } = await supabase
        .from("daily_entry_helpers")
        .select("daily_entry_id, helper_id")
        .in("daily_entry_id", entryIds);
      (helperRows || []).forEach((hr: { daily_entry_id: string; helper_id: string }) => {
        const welderId = welderByEntryId[hr.daily_entry_id];
        const name = helperNameById[hr.helper_id];
        if (!welderId || !name) return;
        const list = ticketHelpersByWelder[welderId] = ticketHelpersByWelder[welderId] || [];
        if (!list.includes(name)) list.push(name);
      });
    }

    // Yard work belongs to the job it was done for, so both the job name and the
    // customer follow the same hop. Otherwise a day in the yard for Targa would
    // file itself under the yard and never reach Targa's log.
    function effectiveJob(r: any) {
      const j = r.job_id ? jobsById[r.job_id] : null;
      if (j?.is_yard && r.for_job_id && jobsById[r.for_job_id]) return jobsById[r.for_job_id];
      return j;
    }
    function jobNameFor(r: any): string {
      const j = effectiveJob(r);
      if (j) return j.name;
      return r.one_off_name || "One-off job";
    }
    function customerFor(r: any): string {
      const j = effectiveJob(r);
      const billTo = (j?.bill_to || "").trim();
      return billTo || NO_CUSTOMER;
    }

    const dateLabel = new Date(targetDate + "T00:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });

    // One bundle per customer. Sorted by name so the emails land in a stable order
    // day to day rather than shuffling with whoever welded most.
    const byCustomer: Record<string, any[]> = {};
    reports.forEach((r) => {
      const c = customerFor(r);
      (byCustomer[c] = byCustomer[c] || []).push(r);
    });
    const customers = Object.keys(byCustomer).sort((a, b) =>
      a === NO_CUSTOMER ? 1 : b === NO_CUSTOMER ? -1 : a.localeCompare(b));

    const sent: any[] = [];

    for (const customer of customers) {
      const custReports = byCustomer[customer];
      const grandTotal = custReports.reduce((s, r) => s + Number(r.total_inches), 0);

      const byWelder: Record<string, Welder> = {};
      custReports.forEach((r) => {
        const key = r.welder_id;
        if (!byWelder[key]) byWelder[key] = {
          name: r.profiles?.full_name || "Unknown welder",
          total: 0,
          hours: hoursByWelder[key] != null ? hoursByWelder[key] : null,
          helper: null,
          rows: [],
        };
        byWelder[key].total += Number(r.total_inches);
        byWelder[key].rows.push(r);
        if (!byWelder[key].helper && r.helper_id) {
          byWelder[key].helper = helperNameById[r.helper_id] || "a helper";
        }
      });
      // Anyone the report left blank gets his ticket's helpers instead.
      Object.keys(byWelder).forEach((key) => {
        if (byWelder[key].helper) return;
        const fromTicket = ticketHelpersByWelder[key];
        if (fromTicket && fromTicket.length) byWelder[key].helper = fromTicket.join(", ");
      });
      const welders = Object.values(byWelder).sort((a, b) => b.total - a.total);

      // Gaps are scoped to this customer's own reports. A backdated report belongs
      // in the log it appears in; a welder with no hours is flagged wherever he
      // shows up, since either log is a fair place for the office to notice.
      const gaps: string[] = [];
      welders.forEach((w) => {
        if (w.hours == null) gaps.push(`${w.name} submitted ${w.total.toFixed(2)} in but has no hours logged for ${targetDate}.`);
      });
      custReports.forEach((r) => {
        if (!r.created_at) return;
        const submittedDate = chicagoDateString(new Date(r.created_at));
        if (submittedDate !== targetDate) {
          const name = r.profiles?.full_name || "Unknown welder";
          const submittedLabel = new Date(r.created_at).toLocaleString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
          gaps.push(`${name}'s report for ${targetDate} was actually submitted ${submittedLabel} -- possible backdating.`);
        }
      });

      const welderSections = welders.map((w) => {
        const jobBlocks = w.rows.map((r) => {
          const breakdown = (r.breakdown || []) as { label: string; qty: number; total: number }[];
          const misc = (r.misc_items || []) as { description: string; inches: number }[];
          const lines: string[] = [];
          breakdown.forEach((b) => lines.push(`${b.label} &times; ${b.qty} = ${b.total} in`));
          misc.forEach((m) => lines.push(`MISC: ${m.description}${m.inches ? " = " + m.inches + " in" : ""}`));
          return `
            <div style="margin-top:10px;padding:10px 12px;background:#20242c;border:1px solid #2c313c;border-radius:8px;">
              <div style="display:flex;justify-content:space-between;font-weight:700;font-size:13px;color:#c7cfd9;">
                <span>${jobNameFor(r)}</span><span style="color:#37b24d;">${Number(r.total_inches).toFixed(2)} in</span>
              </div>
              ${lines.length ? `<div style="font-size:12px;color:#9aa3b2;margin-top:6px;line-height:1.6;">${lines.join("<br>")}</div>` : ""}
            </div>`;
        }).join("");

        const hoursNote = w.hours != null
          ? `<span style="color:#9aa3b2;font-weight:600;font-size:13px;"> &middot; ${w.hours} hrs logged that day</span>`
          : `<span style="color:#e0554f;font-weight:600;font-size:13px;"> &middot; no hours logged</span>`;
        const helperNote = w.helper
          ? `<span style="color:#e9a23b;font-weight:600;font-size:13px;"> &middot; with ${w.helper}</span>`
          : `<span style="color:#6b7280;font-weight:600;font-size:13px;"> &middot; worked alone</span>`;

        return `
          <div style="margin-bottom:18px;padding:14px 16px;background:#1f232c;border:1px solid #2c313c;border-radius:10px;">
            <div style="display:flex;justify-content:space-between;font-weight:700;font-size:15px;color:#e8ebf0;">
              <span>${w.name}${hoursNote}${helperNote}</span><span style="color:#37b24d;">${w.total.toFixed(2)} in</span>
            </div>
            ${jobBlocks}
          </div>`;
      }).join("");

      const gapsHtml = gaps.length ? `
        <div style="margin-bottom:20px;padding:14px 16px;background:#2a1c1c;border:1px solid #5c2d2d;border-radius:10px;">
          <div style="font-weight:800;font-size:14px;color:#f0a3a0;margin-bottom:8px;">&#9888; Data gaps to check</div>
          <ul style="margin:0;padding-left:18px;color:#e8c4c2;font-size:13px;line-height:1.7;">
            ${gaps.map((g) => `<li>${g}</li>`).join("")}
          </ul>
        </div>` : "";

      const otherCustomers = customers.filter((c) => c !== customer);
      const elsewhereNote = otherCustomers.length ? `
        <p style="color:#6b7280;font-size:11px;margin-top:6px;">
          This log covers ${customer} only. ${otherCustomers.length} other
          ${otherCustomers.length === 1 ? "customer was" : "customers were"} worked that day
          and ${otherCustomers.length === 1 ? "has its" : "have their"} own email:
          ${otherCustomers.join(", ")}.
        </p>` : "";

      const html = `
        <div style="font-family:Arial,Helvetica,sans-serif;background:#0f1115;color:#e8ebf0;padding:20px;">
          <h2 style="margin:0 0 4px;">Daily Weld Inch Summary</h2>
          <p style="margin:0 0 2px;font-size:16px;font-weight:700;color:#7fb2e5;">${customer}</p>
          <p style="color:#9aa3b2;margin:0 0 18px;">${dateLabel}</p>
          <div style="font-size:28px;font-weight:800;color:#37b24d;margin-bottom:20px;">${grandTotal.toFixed(2)} in total &middot; ${welders.length} welder${welders.length === 1 ? "" : "s"} reported</div>
          ${gapsHtml}
          ${welderSections}
          <p style="color:#6b7280;font-size:11px;margin-top:22px;">A PDF copy of this log is attached.</p>
          ${elsewhereNote}
        </div>`;

      const text = `Daily Weld Inch Summary - ${customer} - ${dateLabel}\n\n${grandTotal.toFixed(2)} in total across ${welders.length} welder(s)\n\n` +
        (gaps.length ? `DATA GAPS TO CHECK:\n` + gaps.map((g) => `  ! ${g}`).join("\n") + `\n\n` : "") +
        welders.map((w) => `${w.name} (${w.hours != null ? w.hours + " hrs logged that day" : "no hours logged"}${w.helper ? ", with " + w.helper : ", worked alone"}): ${w.total.toFixed(2)} in\n` + w.rows.map((r) => `  - ${jobNameFor(r)}: ${Number(r.total_inches).toFixed(2)} in`).join("\n")).join("\n\n") +
        (otherCustomers.length ? `\n\nThis log covers ${customer} only. Other customers worked that day: ${otherCustomers.join(", ")}.` : "");

      const pdfBytes = await buildPdf(customer, dateLabel, grandTotal, welders, jobNameFor, gaps);
      let pdfBinary = "";
      for (let i = 0; i < pdfBytes.length; i++) pdfBinary += String.fromCharCode(pdfBytes[i]);
      const pdfBase64 = btoa(pdfBinary);

      const fileSafe = customer.replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").trim();

      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: "State of the Arc Alerts <alerts@sotaweld.com>",
          to: toEmail,
          ...(ccList.length ? { cc: ccList } : {}),
          subject: `Weld Log — ${customer} — ${targetDate} — ${grandTotal.toFixed(2)} in${gaps.length ? " — " + gaps.length + " gap(s)" : ""}`,
          html,
          text,
          attachments: [{ filename: `weld-log-${fileSafe}-${targetDate}.pdf`, content: pdfBase64 }],
        }),
      });
      const resData = await res.json();
      sent.push({ customer, ok: res.ok, inches: Number(grandTotal.toFixed(2)), welders: welders.length, gaps: gaps.length, resend: resData });
    }

    return new Response(JSON.stringify({
      ok: sent.every((s) => s.ok),
      targetDate, toEmail, ccList,
      customers: sent.length,
      sent,
    }), { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
  } catch (err) {
    console.error(err);
    const msg = err && err.message ? err.message : JSON.stringify(err);
    return new Response(JSON.stringify({ ok: false, error: msg, raw: String(err) }), { status: 500, headers: CORS_HEADERS });
  }
});
