import { defineConfig } from "@trigger.dev/sdk";

export default defineConfig({
  // Project ref comes from the env (TRIGGER_PROJECT_ID in .env.local /
  // Trigger.dev dashboard) — never hardcoded, same posture as every vendor.
  project: process.env["TRIGGER_PROJECT_ID"] ?? "",
  dirs: ["./src/trigger"],
  maxDuration: 600,
});
