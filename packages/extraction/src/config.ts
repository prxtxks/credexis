/**
 * Env-gated adapter construction (M3.3): an adapter exists iff its
 * credentials do. Nothing here throws on missing keys — callers get null
 * and decide what's fatal (the pipeline needs at least one Path-1 adapter
 * and the Anthropic Path-2; the bake-off wants everything).
 */

import { AnthropicVisionAdapter } from "./adapters/anthropic-vision.js";
import { AzureDocumentIntelligenceAdapter } from "./adapters/azure-document-intelligence.js";
import { ReductoAdapter } from "./adapters/reducto.js";

export interface ConfiguredAdapters {
  reducto: ReductoAdapter | null;
  azureDocumentIntelligence: AzureDocumentIntelligenceAdapter | null;
  anthropicVision: AnthropicVisionAdapter | null;
}

export function createAdaptersFromEnv(
  env: Record<string, string | undefined> = process.env,
): ConfiguredAdapters {
  const reductoKey = env["REDUCTO_API_KEY"];
  const azureEndpoint = env["AZURE_DI_ENDPOINT"];
  const azureKey = env["AZURE_DI_KEY"];
  const anthropicKey = env["ANTHROPIC_API_KEY"];

  return {
    reducto: reductoKey ? new ReductoAdapter({ apiKey: reductoKey }) : null,
    azureDocumentIntelligence:
      azureEndpoint && azureKey
        ? new AzureDocumentIntelligenceAdapter({ endpoint: azureEndpoint, apiKey: azureKey })
        : null,
    anthropicVision: anthropicKey
      ? new AnthropicVisionAdapter({
          apiKey: anthropicKey,
          ...(env["ANTHROPIC_EXTRACTION_MODEL"]
            ? { model: env["ANTHROPIC_EXTRACTION_MODEL"] }
            : {}),
        })
      : null,
  };
}
