// Sets a welder's password on his behalf.
//
// Also confirms his email address, and that is not incidental. A welder invited
// by email exists in an unconfirmed state until he clicks the link in the invite.
// If he never clicks it and the office sets his password by hand instead - which
// is exactly what the office does when the invite goes to a dead address, or the
// man has no email he checks - then he has a working password on an unconfirmed
// account, and Supabase refuses the sign-in anyway.
//
// From the office's side that is indistinguishable from the password not having
// been saved, so they set it again, and again. It cost Manuel Elguezabal a day of
// not being able to log in while the password was correct the whole time.
//
// An admin setting a password by hand is a deliberate act that means "this login
// should work now". So make it work now.

import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData } = await callerClient.auth.getUser();
    if (!userData?.user) {
      return new Response(JSON.stringify({ ok: false, error: "Not authenticated" }), { status: 401, headers: CORS_HEADERS });
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: profile } = await admin.from("profiles").select("role").eq("id", userData.user.id).maybeSingle();
    if (!profile || profile.role !== "admin") {
      return new Response(JSON.stringify({ ok: false, error: "Admins only" }), { status: 403, headers: CORS_HEADERS });
    }

    const { welderId, newPassword } = await req.json();
    if (!welderId || !newPassword || String(newPassword).length < 6) {
      return new Response(JSON.stringify({ ok: false, error: "Password must be at least 6 characters" }), { status: 400, headers: CORS_HEADERS });
    }

    // email_confirm is the whole point of this change - see the note at the top.
    const { error } = await admin.auth.admin.updateUserById(welderId, {
      password: newPassword,
      email_confirm: true,
    });
    if (error) throw error;

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err) }), { status: 500, headers: CORS_HEADERS });
  }
});
