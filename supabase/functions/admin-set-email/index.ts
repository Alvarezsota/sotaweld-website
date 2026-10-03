// Changes the address a welder signs in with, and cuts him a set-password link.
//
// Neither of these existed, and both kept arriving as a message to me.
//
// David Monge was added without an email, so the portal gave him a username --
// david.monge.dpgy@crew.sotaweld.com -- which is not an inbox and never was. No
// invite could reach it, so he had a password he had never been told and no way
// to ask for another. The only fix was somebody editing auth.users by hand.
//
// Aldo Galindo was invited properly, did not open the link inside its day, and
// woke up with no password and no way to make one.
//
// So: an admin can put a real address on a man, and can cut him a link that lets
// him set his own password. Both in one place, on the row with his name on it.
//
// The link is RETURNED as well as emailed, on purpose. Half this crew has an
// address that bounces or is never read; handing Gilbert the link so he can text
// it is the difference between a man logging in today and another message to me.

import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });

// Deliberately loose. The job is to catch a typo like a missing @, not to
// adjudicate what a valid address is -- that argument has no winner and the
// mail server is the real referee.
const looksLikeEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const caller = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData } = await caller.auth.getUser();
    if (!userData?.user) return json({ ok: false, error: "Not authenticated" }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: profile } = await admin.from("profiles")
      .select("role").eq("id", userData.user.id).maybeSingle();
    if (!profile || profile.role !== "admin") return json({ ok: false, error: "Admins only" }, 403);

    const { welderId, newEmail, sendReset, redirectTo } = await req.json();
    if (!welderId) return json({ ok: false, error: "Which welder?" }, 400);

    const { data: before, error: getErr } = await admin.auth.admin.getUserById(welderId);
    if (getErr || !before?.user) return json({ ok: false, error: "No such welder." }, 404);
    let email: string = before.user.email ?? "";

    if (newEmail) {
      const wanted = String(newEmail).trim().toLowerCase();
      if (!looksLikeEmail(wanted)) {
        return json({ ok: false, error: "That does not look like an email address." }, 400);
      }
      if (wanted !== email.toLowerCase()) {
        // Two men on one address is a login that silently belongs to whoever
        // Supabase decides it belongs to. Refuse it with a name attached rather
        // than let the update fail with something unreadable.
        const { data: clash } = await admin.rpc("email_already_used", { p_email: wanted, p_except: welderId });
        if (clash) return json({ ok: false, error: `${clash} already signs in with that address.` }, 409);

        // email_confirm, so he is not left with a working address he still has
        // to confirm from a mailbox that may not exist. Same reasoning as
        // admin-set-password.
        const { error: upErr } = await admin.auth.admin.updateUserById(welderId, {
          email: wanted,
          email_confirm: true,
        });
        if (upErr) throw upErr;
        email = wanted;
      }
    }

    let link: string | null = null;
    if (sendReset) {
      if (!email) return json({ ok: false, error: "He has no address to send to." }, 400);
      const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
        type: "recovery",
        email,
        options: redirectTo ? { redirectTo } : undefined,
      });
      if (linkErr) throw linkErr;
      link = linkData?.properties?.action_link ?? null;
    }

    return json({ ok: true, email, link });
  } catch (err) {
    return json({ ok: false, error: String(err) }, 500);
  }
});
