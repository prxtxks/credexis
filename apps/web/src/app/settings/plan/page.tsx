import { redirect } from "next/navigation";

/** Plan & Usage merged into the top-level Usage page (feedback pass 3). */
export default function SettingsPlanRedirect() {
  redirect("/costs");
}
