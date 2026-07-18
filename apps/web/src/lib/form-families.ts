/**
 * Assignable form-family vocabulary (M6.5): the Stage-S families plus its
 * explicit UNKNOWN sentinel. Lives in lib/ because both the server-side
 * assignment logic and the client picker render it — the client only ever
 * displays and selects labels, it computes nothing (Iron Law #3).
 */

import { formFamilySchema } from "@credexis/schema";

export const ASSIGNABLE_FAMILIES: readonly string[] = [...formFamilySchema.options, "UNKNOWN"];
