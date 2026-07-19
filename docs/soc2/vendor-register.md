# SOC 2 groundwork — Vendor register (M10.4)

Every subprocessor that can touch customer data, what it sees, and its
compliance posture. Update in the same PR as any vendor change.

| Vendor                      | Purpose                            | Data it touches                                                      | Compliance        | Agreements needed                                         |
| --------------------------- | ---------------------------------- | -------------------------------------------------------------------- | ----------------- | --------------------------------------------------------- |
| Supabase                    | DB / Auth / Storage                | ALL tenant data incl. tax PII                                        | SOC 2 Type II     | DPA (standard); PITR before pilot                         |
| Vercel                      | App hosting                        | Request metadata; no docs at rest                                    | SOC 2 Type II     | DPA (standard)                                            |
| Trigger.dev                 | Pipeline jobs                      | Payload ids only (documentId/dealId/tenantId — no file contents)     | SOC 2 Type II     | DPA                                                       |
| Anthropic                   | Classification + Path-2 extraction | Document page text/images (tax PII)                                  | SOC 2 Type II     | **ZDR confirmation required before real docs ([PRATIK])** |
| Reducto                     | Path-1 extraction                  | Full documents (tax PII)                                             | SOC 2             | ZDR/no-retention tier confirmation                        |
| Azure Document Intelligence | 1040-family extraction             | Full documents (tax PII)                                             | SOC 2 / ISO 27001 | Data residency US region ✓; retention config review       |
| Extend (optional)           | Bake-off candidate                 | Documents, only if selected                                          | verify before use | ZDR before any real doc                                   |
| Sentry                      | Error tracking                     | Errors only — payloads/cookies/headers/user stripped by tested scrub | SOC 2 Type II     | DSA (standard)                                            |
| GitHub                      | Source control                     | Code only; secrets blocked by gitleaks CI                            | SOC 2 Type II     | —                                                         |

Rules: no vendor sees real tax documents until its retention posture is
confirmed in writing (row updated with date + link). The extraction
bake-off (M3.4) may remove rows; removal is a PR.
