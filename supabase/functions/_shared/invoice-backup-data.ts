// Reads a job week and hands back the crew sheet as PDF bytes.
//
// Kept apart from invoice-backup-pdf.ts on purpose: that file draws and knows
// nothing about a database, which is what lets it be run against sample data
// outside Deno when the layout is being worked on. This is the half that talks
// to Postgres.
//
// Both callers come through here -- the download button in the invoice preview
// and the push that attaches the sheet to the QuickBooks invoice -- so what he
// reads before sending is the same file the customer ends up holding.

import { buildInvoiceBackup, backupFileName, BackupPayload } from './invoice-backup-pdf.ts';

const LOGO_URL = 'https://sotaweld.com/employee/sota-logo.png';

type Db = {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
  from: (t: string) => {
    select: (c: string) => { in: (col: string, vals: string[]) => Promise<{ data: unknown }> };
  };
};

export type BackupResult =
  | { ok: true; pdf: Uint8Array; filename: string; payload: BackupPayload }
  | { ok: false; error: string };

export async function buildBackupForJobWeek(db: Db, jobWeekId: string): Promise<BackupResult> {
  const { data, error } = await db.rpc('invoice_backup_payload', { p_job_week_id: jobWeekId });
  if (error) {
    const msg = (error as { message?: string }).message ?? String(error);
    return { ok: false, error: `could not read the week: ${msg}` };
  }
  const payload = data as (BackupPayload & { error?: string }) | null;
  if (!payload) return { ok: false, error: 'that job week could not be found' };
  if (payload.error) return { ok: false, error: payload.error };

  const { data: settingRows } = await db.from('app_settings')
    .select('key, value').in('key', ['company_name', 'company_address', 'company_phone']);
  const company: Record<string, string> = {};
  (settingRows as { key: string; value: string }[] | null || [])
    .forEach((r) => { company[r.key] = r.value; });

  // The letterhead reads fine on text alone, so a logo that will not load is
  // never a reason to fail a sheet somebody is waiting on.
  let logo: Uint8Array | null = null;
  try {
    const r = await fetch(LOGO_URL);
    if (r.ok) logo = new Uint8Array(await r.arrayBuffer());
  } catch { /* text-only letterhead */ }

  try {
    const pdf = await buildInvoiceBackup(payload, company, logo);
    return { ok: true, pdf, filename: backupFileName(payload), payload };
  } catch (err) {
    return { ok: false, error: `the sheet could not be drawn: ${(err as Error).message}` };
  }
}

/**
 * Puts the sheet on the QuickBooks invoice as an attachment.
 *
 * IncludeOnSend is on, so when the invoice is sent from QuickBooks the sheet
 * goes with it. That is the whole point of the thing -- the customer gets the
 * hours behind the labour line at the same time as the line -- but it does mean
 * this document reaches them, so nothing on it may be anything they should not
 * see. invoice_backup_payload never selects a pay rate for that reason.
 */
export async function attachToInvoice(opts: {
  apiBase: string; realmId: string; accessToken: string;
  invoiceId: string; pdf: Uint8Array; filename: string;
}): Promise<{ ok: true; attachable_id: string | null } | { ok: false; error: string; intuit_tid?: string | null }> {
  const meta = {
    AttachableRef: [{ EntityRef: { type: 'Invoice', value: opts.invoiceId }, IncludeOnSend: true }],
    FileName: opts.filename,
    ContentType: 'application/pdf',
  };

  const form = new FormData();
  form.append('file_metadata_01',
    new Blob([JSON.stringify(meta)], { type: 'application/json' }), 'metadata.json');
  form.append('file_content_01',
    new Blob([opts.pdf], { type: 'application/pdf' }), opts.filename);

  let res: Response;
  try {
    res = await fetch(`${opts.apiBase}/v3/company/${opts.realmId}/upload?minorversion=75`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${opts.accessToken}`, Accept: 'application/json' },
      body: form,
    });
  } catch (err) {
    return { ok: false, error: `the upload did not reach QuickBooks: ${(err as Error).message}` };
  }

  const tid = res.headers.get('intuit_tid');
  const out = await res.json().catch(() => ({}));

  // QuickBooks answers an upload with a list, one entry per part, and reports a
  // per-part fault inside a 200. Reading only the status code would call a
  // rejected attachment a success.
  const entry = out?.AttachableResponse?.[0];
  const fault = entry?.Fault?.Error?.[0] ?? out?.Fault?.Error?.[0];
  if (!res.ok || fault || !entry?.Attachable?.Id) {
    const detail = fault
      ? `${fault.code ?? '?'} ${fault.Message ?? ''} ${fault.Detail ?? ''}`.trim()
      : JSON.stringify(out).slice(0, 400);
    return { ok: false, error: detail.slice(0, 500) || `upload failed (${res.status})`, intuit_tid: tid };
  }
  return { ok: true, attachable_id: String(entry.Attachable.Id) };
}
