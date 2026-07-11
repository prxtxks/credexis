/**
 * Server-side role enforcement tests (M2.3). Contexts are fabricated — these
 * prove the middleware chain (signed-in → tenant-assigned → role) rejects
 * every insufficient tier with the right TRPC error code, independent of the
 * database.
 */

import type { User } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import type { Context, Profile, UserRole } from "./context";
import { adminProcedure, protectedProcedure, router, underwriterProcedure } from "./init";
import { appRouter } from "./router";

/** Minimal test router exercising each tier (composed from the real builders). */
const testRouter = router({
  needsAuth: protectedProcedure.query(() => "ok-auth"),
  needsWrite: underwriterProcedure.mutation(() => "ok-write"),
  needsAdmin: adminProcedure.mutation(() => "ok-admin"),
});

function ctxFor(state: "anonymous" | "no-profile" | UserRole): Context {
  const user =
    state === "anonymous" ? null : ({ id: "u-1", email: "u@test.local" } as unknown as User);
  const profile: Profile | null =
    state === "anonymous" || state === "no-profile"
      ? null
      : { id: "u-1", tenantId: "t-1", role: state, email: "u@test.local" };
  return { user, profile, supabase: null as never };
}

const caller = (state: Parameters<typeof ctxFor>[0]) => testRouter.createCaller(ctxFor(state));

describe("protectedProcedure", () => {
  it("rejects anonymous callers with UNAUTHORIZED", async () => {
    await expect(caller("anonymous").needsAuth()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("rejects signed-in users with no tenant profile with FORBIDDEN", async () => {
    await expect(caller("no-profile").needsAuth()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("admits every assigned role, viewer included", async () => {
    await expect(caller("viewer").needsAuth()).resolves.toBe("ok-auth");
    await expect(caller("underwriter").needsAuth()).resolves.toBe("ok-auth");
    await expect(caller("admin").needsAuth()).resolves.toBe("ok-auth");
  });
});

describe("underwriterProcedure (writes)", () => {
  it("rejects viewers with FORBIDDEN", async () => {
    await expect(caller("viewer").needsWrite()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("admits underwriters and admins", async () => {
    await expect(caller("underwriter").needsWrite()).resolves.toBe("ok-write");
    await expect(caller("admin").needsWrite()).resolves.toBe("ok-write");
  });
});

describe("adminProcedure", () => {
  it("rejects viewers and underwriters with FORBIDDEN", async () => {
    await expect(caller("viewer").needsAdmin()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller("underwriter").needsAdmin()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("admits admins only", async () => {
    await expect(caller("admin").needsAdmin()).resolves.toBe("ok-admin");
  });
});

describe("appRouter surface", () => {
  it("health is public", async () => {
    await expect(appRouter.createCaller(ctxFor("anonymous")).health()).resolves.toEqual({
      ok: true,
    });
  });

  it("me returns the verified identity for an assigned user", async () => {
    await expect(appRouter.createCaller(ctxFor("underwriter")).me()).resolves.toEqual({
      userId: "u-1",
      email: "u@test.local",
      tenantId: "t-1",
      role: "underwriter",
    });
  });

  it("me rejects anonymous callers", async () => {
    await expect(appRouter.createCaller(ctxFor("anonymous")).me()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });
});
