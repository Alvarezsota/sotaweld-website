// Adds a welder without emailing him anything.
//
// admin-invite-welder is the normal route: it mails a link and the welder picks
// his own password, which is right for someone who will actually use the portal.
// It is the wrong route for a welder who is in the system only so his hours can
// be billed - he has no reason to open an email, and until he does he cannot be
// given rates or assigned to a ticket.
//
// This creates the account directly, with the email already marked confirmed so
// nothing is sent. If he never needs the portal he is simply never told the
// password; if he needs it later it already works.
//
// Admins only: the caller's token is checked against their own profile row
// before the service-role key is used for anything.

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

// A welder with no email still needs one, because it is the login identifier.
// A placeholder on a subdomain that receives no mail keeps the account valid
// without implying the address is real.
function placeholderEmail(fullName: string) {
  const slug = fullName
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 40);
  const suffix = Math.random().toString(36).slice(2, 6);
  return `${slug || 'welder'}.${suffix}@crew.sotaweld.com`;
}

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

  const fullName = String(body.fullName ?? '').trim();
  const password = String(body.password ?? '');
  const emailIn = String(body.email ?? '').trim().toLowerCase();
  const payRate = Number(body.payRate ?? 0);
  const billRate = Number(body.billRate ?? 0);

  if (!fullName) return reply({ error: 'Enter the name of the welder.' }, 400);
  if (password.length < 6) return reply({ error: 'Password must be at least 6 characters.' }, 400);
  if (emailIn && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emailIn)) {
    return reply({ error: 'Enter a valid email address.' }, 400);
  }
  if (!Number.isFinite(payRate) || payRate < 0) return reply({ error: 'Pay rate must be a number.' }, 400);
  if (!Number.isFinite(billRate) || billRate < 0) return reply({ error: 'Bill rate must be a number.' }, 400);

  const email = emailIn || placeholderEmail(fullName);
  const admin = createClient(url, serviceKey);

  // email_confirm skips the confirmation mail - nothing reaches the welder.
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });

  if (createErr || !created?.user) {
    const msg = String(createErr?.message ?? 'Could not add the welder.');
    if (/already (been )?registered|already exists|duplicate/i.test(msg)) {
      return reply({ error: `${email} already has an account. Use Set password on their row instead.` }, 409);
    }
    return reply({ error: msg }, 400);
  }

  const newId = created.user.id;

  // A signup trigger may already have written the profile row, so upsert rather
  // than insert - otherwise this collides with the trigger's row.
  const { data: profile, error: profileErr } = await admin
    .from('profiles')
    .upsert(
      { id: newId, full_name: fullName, pay_rate: payRate, bill_rate: billRate, role: 'welder' },
      { onConflict: 'id' },
    )
    .select()
    .single();

  if (profileErr) {
    // A login with no profile is a welder who can sign in and appear nowhere,
    // so undo the account rather than leave it half-made.
    await admin.auth.admin.deleteUser(newId);
    return reply({ error: 'Could not save the welder: ' + profileErr.message }, 400);
  }

  return reply({ ok: true, profile, email, generatedEmail: !emailIn });
});
