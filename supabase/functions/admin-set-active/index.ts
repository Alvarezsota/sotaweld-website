// Archiving a man closes his account. Bringing him back opens it again.
//
// Archiving used to be a single column: profiles.active went false, he dropped
// off the pickers and the crew board, and his login carried on working exactly
// as before. Jose Franco was archived by mistake on 15 September and filed
// tickets and weld reports for a fortnight afterwards with nothing in his way.
// That is the harmless version. The other one is a man who has actually left
// still holding a working key to the job list, the rates and the weld history.
//
// So the toggle does both now: the profile row and the account behind it. They
// have to move together, and the account can only be touched with the service
// role, which is why this exists rather than the page writing the column.
//
// ORDER MATTERS
// ---------------------------------------------------------------------------
// Archiving: ban first, then write the column. If the ban fails, nothing is
// written and the office is told -- better a man who still shows in the pickers
// than one who is invisible and can still sign in.
//
// Bringing back: unban first, then the column, for the mirror reason. A man
// listed as working who cannot log in is a support call; a man who can log in
// but is not yet listed is a few seconds of nothing.
//
// Admins only, checked against the caller's own profile before the service role
// is used for anything.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function reply(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

/* Supabase has no "forever" ban, so it takes a duration. A hundred years is
   forever for this purpose, and 'none' is how a ban is lifted. */
const FOREVER = `${100 * 365 * 24}h`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return reply({ error: 'Use POST' }, 405);

  const url = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return reply({ error: 'Not signed in' }, 401);

  const caller = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: userErr } = await caller.auth.getUser();
  if (userErr || !user) return reply({ error: 'Not signed in' }, 401);

  const { data: callerProfile } = await caller
    .from('profiles').select('role').eq('id', user.id).single();
  if (!callerProfile || callerProfile.role !== 'admin') {
    return reply({ error: 'Admins only' }, 403);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return reply({ error: 'Bad request body' }, 400);
  }

  const personId = String(body.personId ?? '').trim();
  const active = body.active === true;
  if (!personId) return reply({ error: 'Which person?' }, 400);

  // Locking yourself out of the tool you lock people out with is a bad
  // afternoon, and there is no way back in from the page afterwards.
  if (personId === user.id && !active) {
    return reply({ error: 'You cannot archive yourself.' }, 400);
  }

  const admin = createClient(url, serviceKey);

  const { data: target } = await admin
    .from('profiles').select('id, full_name, active').eq('id', personId).maybeSingle();
  if (!target) return reply({ error: 'That person could not be found.' }, 404);

  const banOrLift = async (ban: boolean) => {
    const { error } = await admin.auth.admin.updateUserById(personId, {
      ban_duration: ban ? FOREVER : 'none',
    });
    return error;
  };

  if (!active) {
    const banErr = await banOrLift(true);
    if (banErr) {
      return reply({ error: 'Their account could not be closed, so nothing was changed: '
        + banErr.message }, 502);
    }
  } else {
    const liftErr = await banOrLift(false);
    if (liftErr) {
      return reply({ error: 'Their account could not be re-opened, so nothing was changed: '
        + liftErr.message }, 502);
    }
  }

  const { data: saved, error: rowErr } = await admin
    .from('profiles')
    .update({ active, archived_at: active ? null : new Date().toISOString() })
    .eq('id', personId)
    .select('id, full_name, active, archived_at')
    .single();

  if (rowErr) {
    // Put the account back the way it was rather than leave the two disagreeing.
    await banOrLift(!active);
    return reply({ error: 'Nothing was changed: ' + rowErr.message }, 400);
  }

  return reply({ ok: true, profile: saved });
});
