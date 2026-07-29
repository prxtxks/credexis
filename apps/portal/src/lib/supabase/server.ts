import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { supabaseEnv } from "@/lib/env";

/**
 * Server-side Supabase client bound to the request's cookies (anon key; the
 * borrower's own JWT does the authorizing — Iron Law #7: no service-role key
 * in request paths). Every read the portal performs goes through a
 * SECURITY DEFINER function that re-derives the invite from auth.uid(), so
 * this client can hold nothing but the caller's own authority.
 */
export async function createClient() {
  const env = supabaseEnv();
  if (!env) throw new Error("portal: NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY are not configured");
  const cookieStore = await cookies();
  return createServerClient(env.url, env.anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component — middleware handles refresh.
        }
      },
    },
  });
}
