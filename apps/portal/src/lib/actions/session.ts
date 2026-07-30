"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * Sign out. Borrowers routinely open these links on shared or borrowed
 * devices, so leaving is a first-class action even though there is no
 * re-authentication form to come back through - the emailed link is the only
 * way in (design 05 §10.2, screen 4).
 */
export async function signOut(): Promise<void> {
  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.signOut();
    if (error) console.error("portal: sign out failed", error.message);
  } catch (cause) {
    console.error("portal: sign out threw", cause);
  }

  // Belt for the brace: if the auth call failed, the session cookies must
  // still go. A sign-out that silently leaves a live cookie is worse than no
  // sign-out button at all.
  const store = await cookies();
  for (const cookie of store.getAll()) {
    if (cookie.name.startsWith("sb-")) store.delete(cookie.name);
  }

  redirect("/signed-out");
}
