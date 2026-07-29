import { defineConfig } from "@trigger.dev/sdk";
import { syncEnvVars } from "@trigger.dev/build/extensions/core";

export default defineConfig({
  // Project ref comes from the env (TRIGGER_PROJECT_ID in .env.local /
  // Trigger.dev dashboard) — never hardcoded, same posture as every vendor.
  project: process.env["TRIGGER_PROJECT_ID"] ?? "",
  dirs: ["./src/trigger"],
  maxDuration: 600,
  build: {
    extensions: [
      // Deploy-time env sync: the worker needs Supabase (service role —
      // legal here, worker-side only, Iron Law #7) and the classifier key.
      // Values come from the local .env.local at deploy time and land as
      // Trigger.dev environment variables — never in the image.
      syncEnvVars(() => {
        const required = {
          SUPABASE_URL: process.env["NEXT_PUBLIC_SUPABASE_URL"] ?? "",
          SUPABASE_SERVICE_ROLE_KEY: process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "",
          ANTHROPIC_API_KEY: process.env["ANTHROPIC_API_KEY"] ?? "",
        };
        for (const [name, value] of Object.entries(required)) {
          if (!value) throw new Error(`syncEnvVars: ${name} missing in deploy environment`);
        }
        const optional = [
          "SENTRY_DSN",
          "REDUCTO_API_KEY",
          "AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT",
          "AZURE_DOCUMENT_INTELLIGENCE_KEY",
          // M11.7 email: the worker sends approval + digest mail. Without
          // these the sender is a silent no-op in production even when the
          // key exists locally — the failure mode that hid until now.
          "RESEND_API_KEY",
          "EMAIL_FROM",
          // Absolute base for links in email (emails cannot use app-relative
          // URLs the way in-app action_url does).
          "NEXT_PUBLIC_APP_URL",
        ];
        return [
          ...Object.entries(required).map(([name, value]) => ({ name, value })),
          ...optional.flatMap((name) =>
            process.env[name] ? [{ name, value: process.env[name] }] : [],
          ),
        ];
      }),
    ],
  },
});
