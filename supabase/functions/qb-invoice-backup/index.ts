// Hands back the crew sheet for one job week as a PDF.
//
// This is the "let me read it before it goes" door. The push attaches the same
// sheet to the QuickBooks invoice by itself; this exists so the office can open
// it first, on a week that has not been sent and on one that has.
//
// Admin only. It carries every man's name, hours and billed rate for a week,
// which is not a welder's to pull for a job he was not on.

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { buildBackupForJobWeek } from '../_shared/invoice-backup-data.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Expose-Headers': 'content-disposition',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const json = (b: Record<string, unknown>, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

  try {
    const auth = req.headers.get('Authorization') ?? '';
    const asCaller = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: auth } } });
    const { data: who } = await asCaller.auth.getUser();
    if (!who?.user) return json({ ok: false, error: 'not signed in' }, 401);

    const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: me } = await db.from('profiles').select('role').eq('id', who.user.id).maybeSingle();
    if (me?.role !== 'admin') return json({ ok: false, error: 'admins only' }, 403);

    const body = await req.json().catch(() => ({}));
    const jobWeekId = body.job_week_id ?? null;
    if (!jobWeekId) return json({ ok: false, error: 'job_week_id is required' }, 400);

    const out = await buildBackupForJobWeek(db as never, String(jobWeekId));
    if (!out.ok) return json({ ok: false, error: out.error }, 422);

    return new Response(out.pdf, {
      headers: {
        ...CORS,
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${out.filename.replace(/"/g, '')}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
