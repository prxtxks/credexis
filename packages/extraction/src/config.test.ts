import { describe, expect, it } from "vitest";
import { createAdaptersFromEnv } from "./config.js";

describe("env-gated adapter construction (M3.3)", () => {
  it("no credentials → no adapters (never a half-configured one)", () => {
    const a = createAdaptersFromEnv({});
    expect(a.reducto).toBeNull();
    expect(a.azureDocumentIntelligence).toBeNull();
    expect(a.anthropicVision).toBeNull();
  });

  it("each adapter exists iff its credentials do", () => {
    const a = createAdaptersFromEnv({
      REDUCTO_API_KEY: "rk",
      ANTHROPIC_API_KEY: "ak",
      AZURE_DI_ENDPOINT: "https://x.cognitiveservices.azure.com",
      // AZURE_DI_KEY missing → azure stays null (endpoint alone is not enough)
    });
    expect(a.reducto?.name).toBe("reducto");
    expect(a.anthropicVision?.name).toBe("anthropic-vision");
    expect(a.azureDocumentIntelligence).toBeNull();
  });

  it("model override reaches the anthropic adapter", () => {
    const a = createAdaptersFromEnv({
      ANTHROPIC_API_KEY: "ak",
      ANTHROPIC_EXTRACTION_MODEL: "claude-opus-4-8",
    });
    expect(a.anthropicVision?.model).toBe("claude-opus-4-8");
  });
});
