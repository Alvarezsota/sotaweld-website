// Forgets the OneDrive connection.
//
// Deletes the stored tokens and nothing else. Statements already filed stay where
// they are - this is about whether the system may keep writing, not about taking
// back what it wrote. Approved weeks simply stop filing until it is reconnected.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405);

  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return json({ error: 'Not signed in' }, 401);

  const caller = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
  const { data: { user } } = await caller.auth.getUser();
  if (!user) return json({ error: 'Not signed in' }, 401);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: profile } = await admin.from('profiles').select('role').eq('id', user.id).maybeSingle();
  if (!profile || profile.role !== 'admin') return json({ error: 'Admins only' }, 403);

  const { error } = await admin.from('onedrive_tokens').delete().eq('id', 1);
  if (error) return json({ error: error.message }, 500);

  // Spent and stale consent states are of no use once the connection is gone.
  await admin.from('onedrive_oauth_state').delete().not('state', 'is', null);

  return json({ ok: true });
});
