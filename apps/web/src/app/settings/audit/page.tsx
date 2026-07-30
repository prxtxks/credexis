import { redirect } from "next/navigation";

/** The audit log is top-level now (feedback pass 3). */
export default function SettingsAuditRedirect() {
  redirect("/audit");
}
