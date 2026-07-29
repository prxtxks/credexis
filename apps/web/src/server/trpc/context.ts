import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

export type UserRole = "org_owner" | "admin" | "underwriter" | "viewer";

export interface Profile {
  id: string;
  tenantId: string;
  role: UserRole;
  email: string;
}

export interface Context {
  /** Verified auth user (JWT revalidated via getUser), or null. */
  user: User | null;
  /** The user's tenant membership; null until an admin assigns a tenant. */
  profile: Profile | null;
  /** Request-scoped Supabase client (anon key + caller's JWT; RLS applies). */
  supabase: SupabaseClient;
}

/**
 * tRPC context (M2.3): verify the caller's JWT server-side (Iron Law #7 —
 * every route authenticates), then load their profile (tenant + role) through
 * an RLS-scoped query. A signed-in user with no profile has no tenant and is
 * treated as unauthorized by `protectedProcedure`.
 */
export async function createContext(): Promise<Context> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let profile: Profile | null = null;
  if (user) {
    const { data } = await supabase
      .from("profiles")
      .select("id, tenant_id, role, email")
      .eq("id", user.id)
      .maybeSingle();
    if (data) {
      profile = {
        id: data.id as string,
        tenantId: data.tenant_id as string,
        role: data.role as UserRole,
        email: data.email as string,
      };
    }
  }
  return { user, profile, supabase };
}
