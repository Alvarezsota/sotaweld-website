// The daily weld log, sent one email per customer.
//
// It used to be a single email covering everyone's inches across every job. That
// is the wrong shape for what it is actually used for: the office forwards this
// to the customer, and a log covering Rocking Double S and BT Constructors in one
// document cannot be forwarded to either of them without editing it first.
//
// So the day is split by who gets billed and each customer gets its own email,
// its own subject line and its own PDF. Forwarding one is now the whole job
// rather than the start of one.
//
// Who gets billed is the QuickBooks customer the job is linked to, never the
// bill_to text. Splitting on the text meant "Rocking Double S LLC" typed on one
// job and "ROCKING DOUBLE S LLC" picked from the dropdown on the next were two
// different companies, and one day's welding went out as two logs that each
// looked complete. Two jobs pointing at the same customer are the same customer,
// whatever anybody typed.
//
// A welder who worked two customers in a day appears in both, with only that
// customer's inches under his name - and now only that customer's hours. The
// hours ticket records them against a job, so a split day is shown split: six
// hours here, six hours there, each beside the inches that came off it. What
// used to print was one number for the whole day against whichever job he
// happened to weld on, which made half a day's work look like a bad one.
//
// ---------------------------------------------------------------------------
// THE EMAIL IS FOR THE OFFICE. THE PDF IS FOR THE CUSTOMER.
// ---------------------------------------------------------------------------
//
// Both are built from the same day, and they do not carry the same things. The
// data gaps - a man with inches and no hours ticket, a report filed two days
// after the date on it - are the office's business and stay in the email body
// and its subject line. The attached PDF is the half that gets forwarded, and
// it carries none of them.

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
  // x-sota-secret is on this list because the database calls this function with
  // it. It was added to the deployed copy and never made it back to the repo, so
  // a later deploy from here would have quietly dropped it and failed preflight.
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-sota-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function chicagoDateString(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

type JobLine = { id: string; name: string; inches: number; hours: number | null; rows: any[] };
type Welder = {
  name: string; total: number; helper: string | null; rows: any[];
  jobs: JobLine[];
  // Hours on this customer's jobs, and hours across his whole day. They differ
  // when a man split the day, which is the case this was built for.
  hours: number | null; dayHours: number | null;
};

/* The PDF is the half that leaves the building.
 *
 * It carries no gaps. A gap is an instruction to the office - chase a missing
 * ticket, ask a man why his report was filed two days late - and "possible
 * backdating" printed on a document handed to the customer reads as an
 * admission that the hours on it are in doubt. They are not; they are being
 * checked, which is a different thing and none of the customer's business.
 *
 * They stay in the email body, which is read here and forwarded nowhere. Not
 * taking them as an argument is deliberate: a parameter that must not be drawn
 * is one somebody eventually draws.
 */
async function buildPdf(customer: string, dateLabel: string, grandTotal: number, welders: Welder[]): Promise<Uint8Array> {
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
    // His hours on this customer, against the whole day when they differ.
    const split = w.hours != null && w.dayHours != null && w.hours < w.dayHours;
    const hoursLabel = w.dayHours == null ? "no hours logged"
      : split ? `${w.hours} of ${w.dayHours} hrs` : `${w.dayHours} hrs logged`;
    const hoursColor = w.dayHours == null ? rgb(0.75, 0.2, 0.2) : rgb(0.45, 0.45, 0.45);
    text(hoursLabel, pageW - margin - 160, 10, font, hoursColor);
    text(`${w.total.toFixed(2)} in`, pageW - margin - 70, 13, bold, rgb(0.13, 0.5, 0.25));
    y -= 18;

    // One line per job, carrying the hours worked on it as well as the inches.
    // A job with hours and no inches is on here too: cutting and prepping is
    // work, and leaving it off makes the rest of the day look like the whole of
    // it. This is the customer's own copy, so it is the customer's own jobs.
    for (const jl of w.jobs) {
      newPageIfNeeded(16);
      text(`${jl.name}`, margin + 14, 11, bold, rgb(0.2, 0.2, 0.2));
      if (jl.hours != null) {
        text(`${jl.hours} hrs`, pageW - margin - 160, 10, font, rgb(0.45, 0.45, 0.45));
      }
      text(jl.inches > 0 ? `${jl.inches.toFixed(2)} in` : "\u2014",
           pageW - margin - 70, 11, font, rgb(0.13, 0.5, 0.25));
      y -= 14;

      for (const r of jl.rows) {
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
    let onlyCustomer: string | null = null;
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
      // Re-sending one customer's log should not re-send everybody else's. Naming
      // a customer sends that bundle only; the day is still read whole, so the
      // "other customers were worked that day" note stays true.
      if (typeof body.customer === "string" && body.customer.trim()) onlyCustomer = body.customer.trim();
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
      supabase.from("jobs").select("id, name, is_yard, bill_to, qb_customer_id, qb_customer_name"),
      supabase.from("daily_entries").select("id, welder_id, hours, job_id, for_job_id").eq("entry_date", targetDate),
      supabase.from("helpers_public").select("id, name"),
    ]);

    if (error) throw error;
    if (jobsError) throw jobsError;
    if (entriesError) throw entriesError;

    if (!reports || reports.length === 0) {
      return new Response(JSON.stringify({ ok: true, skipped: true, reason: "no reports for " + targetDate }), { status: 200, headers: CORS_HEADERS });
    }

    const jobsById: Record<string, { id: string; name: string; is_yard: boolean; bill_to: string | null; qb_customer_id: string | null; qb_customer_name: string | null }> = {};
    (jobs || []).forEach((j) => { jobsById[j.id] = j; });

    /* Yard work belongs to the job it was done for. One rule, used by the weld
       reports, the hours tickets and the customer split alike - a day in the
       yard for Targa has to land on Targa in all three or the three disagree. */
    function effectiveJobId(jobId: string | null, forJobId: string | null): string | null {
      const j = jobId ? jobsById[jobId] : null;
      if (j?.is_yard && forJobId && jobsById[forJobId]) return forJobId;
      return jobId || null;
    }

    const helperNameById: Record<string, string> = {};
    (helpers || []).forEach((h: { id: string; name: string }) => { helperNameById[h.id] = h.name; });

    // Hours twice over: the day's total, and the same hours split by the job
    // they were worked on.
    //
    // A man who splits a day was reading as one number against one job. Gilbert
    // Alvarez on 5 Sep is the case: 6 hours fabricating at P66 Viper, where his
    // inches are, and 6 hours cutting and prepping for the Targa bullmoose to
    // yeti stainless, where there are no inches because prep does not produce
    // any. The log said "12 hrs" beside 135 inches at Viper - it made his day
    // look half as productive as it was and left the other job off the page.
    const hoursByWelder: Record<string, number> = {};
    const jobHours: Record<string, Record<string, number>> = {};
    const welderByEntryId: Record<string, string> = {};
    (entries || []).forEach((e) => {
      hoursByWelder[e.welder_id] = (hoursByWelder[e.welder_id] || 0) + Number(e.hours);
      welderByEntryId[e.id] = e.welder_id;
      const jid = effectiveJobId(e.job_id, e.for_job_id);
      if (!jid) return;
      const forWelder = jobHours[e.welder_id] = jobHours[e.welder_id] || {};
      forWelder[jid] = (forWelder[jid] || 0) + Number(e.hours);
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

    // The job name and the customer follow the same hop the hours do.
    function effectiveJob(r: any) {
      const id = effectiveJobId(r.job_id ?? null, r.for_job_id ?? null);
      return id ? jobsById[id] ?? null : null;
    }
    function customerOfJobId(id: string): string {
      const j = jobsById[id];
      return (j?.qb_customer_name || "").trim() || (j?.bill_to || "").trim() || NO_CUSTOMER;
    }
    function jobNameFor(r: any): string {
      const j = effectiveJob(r);
      if (j) return j.name;
      return r.one_off_name || "One-off job";
    }
    // The QuickBooks name first, so every job linked to that customer lands in
    // one bundle however its bill_to was typed. The typed text is only a
    // fallback, for a job with no customer picked yet.
    function customerFor(r: any): string {
      const j = effectiveJob(r);
      return (j?.qb_customer_name || "").trim()
          || (j?.bill_to || "").trim()
          || NO_CUSTOMER;
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

    // Named a customer? Match it loosely, so "rocking double s" finds
    // "ROCKING DOUBLE S LLC" without anybody having to type it exactly.
    const wanted = onlyCustomer
      ? customers.filter((c) => c.toLowerCase().includes(onlyCustomer!.toLowerCase())
                             || onlyCustomer!.toLowerCase().includes(c.toLowerCase()))
      : customers;
    if (onlyCustomer && !wanted.length) {
      return new Response(JSON.stringify({
        ok: false,
        error: `No weld reports for ${onlyCustomer} on ${targetDate}. Worked that day: ${customers.join(", ")}.`,
      }), { status: 404, headers: CORS_HEADERS });
    }

    const sent: any[] = [];

    for (const customer of wanted) {
      const custReports = byCustomer[customer];
      const grandTotal = custReports.reduce((s, r) => s + Number(r.total_inches), 0);

      const byWelder: Record<string, Welder> = {};
      custReports.forEach((r) => {
        const key = r.welder_id;
        if (!byWelder[key]) byWelder[key] = {
          name: r.profiles?.full_name || "Unknown welder",
          total: 0,
          hours: null,
          dayHours: hoursByWelder[key] != null ? hoursByWelder[key] : null,
          helper: null,
          rows: [],
          jobs: [],
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

      /* A man's day, job by job.
       *
       * Two sources meet here and neither is complete on its own. The weld
       * reports say where the inches went; the hours ticket says where the time
       * went. A job can appear on one and not the other:
       *
       *   inches and no hours - he welded it but has not filed his ticket yet.
       *   hours and no inches - cutting, prepping, fitting. Real work, no inches
       *     to show for it, and it must not vanish or the day reads as though
       *     the rest of it was spent on whatever he did weld.
       *
       * Grouped by job rather than per report, so two reports on one job are one
       * line with the hours counted once.
       *
       * Only this customer's jobs. A man who spent the morning on Rocking Double
       * S and the afternoon on BT Constructors gets each half in that customer's
       * own log and neither log names the other's work.
       */
      Object.keys(byWelder).forEach((key) => {
        const w = byWelder[key];
        const mine = jobHours[key] || {};
        const byJob: Record<string, JobLine> = {};

        w.rows.forEach((r: any) => {
          const id = effectiveJobId(r.job_id ?? null, r.for_job_id ?? null)
                  || `oneoff:${r.one_off_name || "One-off job"}`;
          const line = byJob[id] || (byJob[id] = {
            id, name: jobNameFor(r), inches: 0, hours: null, rows: [],
          });
          line.inches += Number(r.total_inches);
          line.rows.push(r);
        });

        Object.values(byJob).forEach((line) => {
          const h = mine[line.id];
          if (h > 0) line.hours = h;
        });

        // Hours on this customer's jobs that produced no weld report.
        Object.keys(mine).forEach((jid) => {
          if (byJob[jid]) return;
          const j = jobsById[jid];
          if (!j || customerOfJobId(jid) !== customer) return;
          byJob[jid] = { id: jid, name: j.name, inches: 0, hours: mine[jid], rows: [] };
        });

        w.jobs = Object.values(byJob).sort((a, b) =>
          (b.inches - a.inches) || ((b.hours || 0) - (a.hours || 0)) || a.name.localeCompare(b.name));

        // His hours on this customer. Null rather than zero when no ticket has
        // been filed at all, because "none logged" and "none yet" are different
        // things and only the first is a gap.
        const onThis = w.jobs.reduce((sum, l) => sum + (l.hours || 0), 0);
        w.hours = onThis > 0 ? onThis : (w.dayHours != null ? 0 : null);
      });

      const welders = Object.values(byWelder).sort((a, b) => b.total - a.total);

      // Gaps are scoped to this customer's own reports. A backdated report belongs
      // in the log it appears in; a welder with no hours is flagged wherever he
      // shows up, since either log is a fair place for the office to notice.
      //
      // These reach the email and the subject line and stop there. The attached
      // PDF is the half that gets forwarded to the customer, and it does not
      // take them - see buildPdf.
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
        const jobBlocks = w.jobs.map((jl) => {
          const lines: string[] = [];
          jl.rows.forEach((r: any) => {
            const breakdown = (r.breakdown || []) as { label: string; qty: number; total: number }[];
            const misc = (r.misc_items || []) as { description: string; inches: number }[];
            breakdown.forEach((b) => lines.push(`${b.label} &times; ${b.qty} = ${b.total} in`));
            misc.forEach((m) => lines.push(`MISC: ${m.description}${m.inches ? " = " + m.inches + " in" : ""}`));
          });
          // Hours first, then inches. The hours are what was in question.
          const hrs = jl.hours != null
            ? `<span style="color:#e9a23b;">${jl.hours} hrs</span>`
            : `<span style="color:#6b7280;">hours not logged</span>`;
          const inches = jl.inches > 0
            ? `<span style="color:#37b24d;">${jl.inches.toFixed(2)} in</span>`
            : `<span style="color:#6b7280;">no inches</span>`;
          return `
            <div style="margin-top:10px;padding:10px 12px;background:#20242c;border:1px solid #2c313c;border-radius:8px;">
              <div style="display:flex;justify-content:space-between;font-weight:700;font-size:13px;color:#c7cfd9;">
                <span>${jl.name}</span><span>${hrs} &nbsp;&middot;&nbsp; ${inches}</span>
              </div>
              ${lines.length ? `<div style="font-size:12px;color:#9aa3b2;margin-top:6px;line-height:1.6;">${lines.join("<br>")}</div>` : ""}
            </div>`;
        }).join("");

        // The header carries his hours on this customer, and says so against the
        // whole day when the two differ - which is the shape of a split day.
        const split = w.hours != null && w.dayHours != null && w.hours < w.dayHours;
        const hoursNote = w.dayHours == null
          ? `<span style="color:#e0554f;font-weight:600;font-size:13px;"> &middot; no hours logged</span>`
          : split
            ? `<span style="color:#9aa3b2;font-weight:600;font-size:13px;"> &middot; ${w.hours} of ${w.dayHours} hrs that day</span>`
            : `<span style="color:#9aa3b2;font-weight:600;font-size:13px;"> &middot; ${w.dayHours} hrs logged that day</span>`;
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

      // The office's copy of the gaps. This block is in the email body only.
      const gapsHtml = gaps.length ? `
        <div style="margin-bottom:20px;padding:14px 16px;background:#2a1c1c;border:1px solid #5c2d2d;border-radius:10px;">
          <div style="font-weight:800;font-size:14px;color:#f0a3a0;margin-bottom:8px;">&#9888; Data gaps to check</div>
          <ul style="margin:0;padding-left:18px;color:#e8c4c2;font-size:13px;line-height:1.7;">
            ${gaps.map((g) => `<li>${g}</li>`).join("")}
          </ul>
          <p style="margin:10px 0 0;font-size:11.5px;color:#b99a98;">For the office. None of this is on the attached PDF.</p>
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
          <p style="color:#6b7280;font-size:11px;margin-top:22px;">A PDF copy of this log is attached, ready to forward.</p>
          ${elsewhereNote}
        </div>`;

      const text = `Daily Weld Inch Summary - ${customer} - ${dateLabel}\n\n${grandTotal.toFixed(2)} in total across ${welders.length} welder(s)\n\n` +
        (gaps.length ? `DATA GAPS TO CHECK (office only - not on the attached PDF):\n` + gaps.map((g) => `  ! ${g}`).join("\n") + `\n\n` : "") +
        welders.map((w) => {
          const hrsLabel = w.dayHours == null ? "no hours logged"
            : (w.hours != null && w.hours < w.dayHours) ? `${w.hours} of ${w.dayHours} hrs that day`
            : `${w.dayHours} hrs logged that day`;
          return `${w.name} (${hrsLabel}${w.helper ? ", with " + w.helper : ", worked alone"}): ${w.total.toFixed(2)} in\n`
            + w.jobs.map((jl) => `  - ${jl.name}: ${jl.hours != null ? jl.hours + " hrs" : "hours not logged"}, ${jl.inches > 0 ? jl.inches.toFixed(2) + " in" : "no inches"}`).join("\n");
        }).join("\n\n") +
        (otherCustomers.length ? `\n\nThis log covers ${customer} only. Other customers worked that day: ${otherCustomers.join(", ")}.` : "");

      const pdfBytes = await buildPdf(customer, dateLabel, grandTotal, welders);
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
      sent.push({ customer, ok: res.ok, inches: Number(grandTotal.toFixed(2)), welders: welders.length, gaps: gaps.length, helpers: welders.map((w) => `${w.name}: ${w.helper || "alone"}`), resend: resData });
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
