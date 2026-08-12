import { describe, expect, it } from "vitest";
import type { ExtractorAdapter, LayoutParseResult } from "../types.js";
import { LayoutFallbackAdapter } from "./layout-fallback.js";

const page = (vendor: string): LayoutParseResult =>
  ({
    pages: [{ page: 1, tables: [] }],
    run: { vendor, vendorVersion: "1", pageCount: 1, costMicroUsd: 10n },
  }) as unknown as LayoutParseResult;

const healthy = (name: string): ExtractorAdapter =>
  ({
    name,
    async parseLayout() {
      return page(name);
    },
    async extractFields() {
      throw new Error("unused");
    },
  }) as unknown as ExtractorAdapter;

const dead = (name: string, msg: string): ExtractorAdapter =>
  ({
    name,
    async parseLayout() {
      throw new Error(msg);
    },
    async extractFields() {
      throw new Error("unused");
    },
  }) as unknown as ExtractorAdapter;

describe("LayoutFallbackAdapter (M18.4 - the Reducto credit outage)", () => {
  it("serves from the primary when healthy, no failover claimed", async () => {
    const a = new LayoutFallbackAdapter(healthy("reducto"), healthy("azure-di"));
    const r = await a.parseLayout({} as never);
    expect(r.run.vendor).toBe("reducto");
    expect(a.lastFailover).toBeNull();
  });

  it("fails over when the primary throws, and says so", async () => {
    const a = new LayoutFallbackAdapter(
      dead("reducto", "reducto /upload failed (401)"),
      healthy("azure-di"),
    );
    const r = await a.parseLayout({} as never);
    expect(r.run.vendor).toBe("azure-di"); // lineage carries the SERVING vendor
    expect(a.lastFailover).toMatchObject({
      servedBy: "azure-di",
      primaryError: "reducto /upload failed (401)",
    });
  });

  it("both dead → the fallback's error propagates and no failover is claimed", async () => {
    const a = new LayoutFallbackAdapter(dead("reducto", "401"), dead("azure-di", "azure down"));
    await expect(a.parseLayout({} as never)).rejects.toThrow("azure down");
    expect(a.lastFailover).toBeNull();
  });
});
