import { redirect } from "next/navigation";

/** Members is top-level now (feedback pass 3) — settings holds only
 *  General / Notifications / Security. */
export default function SettingsMembersRedirect() {
  redirect("/members");
}
