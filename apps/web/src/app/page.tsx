import { createClient } from "@/lib/supabase/server";

/** Behind the middleware guard: only signed-in users reach this. */
export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profile } = user
    ? await supabase.from("profiles").select("role, tenant_id").eq("id", user.id).maybeSingle()
    : { data: null };

  return (
    <main style={{ maxWidth: 640, margin: "10vh auto", fontFamily: "system-ui" }}>
      <h1>Credexis</h1>
      <p>Signed in as {user?.email ?? "unknown"}.</p>
      {profile ? (
        <p>
          Role: {String(profile.role)} · Tenant: {String(profile.tenant_id)}
        </p>
      ) : (
        <p>No workspace assigned to this account yet — ask your administrator.</p>
      )}
      <form action="/auth/signout" method="post">
        <button type="submit">Sign out</button>
      </form>
    </main>
  );
}
