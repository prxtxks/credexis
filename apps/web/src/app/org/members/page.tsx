import { redirect } from "next/navigation";

/** Members moved into the settings section (ui-17, plan 01 step 11). */
export default function OrgMembersRedirect() {
  redirect("/settings/members");
}
