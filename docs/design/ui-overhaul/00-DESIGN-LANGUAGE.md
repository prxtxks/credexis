# Credexis Design Language v1 — "Precision Instrument"

> **Amended 2026-07-30 by `02-VERCEL-DERIVATION.md` (binding):** the reference
> is now Vercel's dashboard, measured from 35 captures ("match 100%, our
> colors" — Pratik). Where this file conflicts with 02, 02 wins. Specifically
> superseded here: the 135° emerald **gradient on primary buttons** (§2 Color —
> primaries are now flat white/near-black inverse; emerald is the accent that
> replaces Vercel's blue), the **24/18/15/13/11 type scale** (§2 Type — now
> 28/20/16/14/13/11), the **10/14/20 radii** (§2 Geometry — now 8/12/16/20),
> and the **mobile bottom tab bar** (§2 Density — mobile nav is the floating
> Find/menu pill + nav sheet).

Directive (Pratik, 2026-07-29): UI is now the top priority. World-class,
distinctive, not AI-generated-looking — "as if Apple collaborated with the
best UI design team." Enterprise-grade responsiveness at every inch.

## 1. Honest diagnosis — why it reads as AI-generated

1. **Generic glassmorphism.** `glass-card` + gradient mesh + emerald accent
   is the 2024-era template look. Transparency without a surface SYSTEM
   (defined elevation levels, hairlines, light logic) reads as decoration,
   not design. The notification popover being see-through on mobile is this
   bug in miniature: transparency used where legibility was needed.
2. **No typographic conviction.** Everything is text-sm/muted-foreground.
   A real product has a scale with contrast: numbers are the protagonist in
   an underwriting tool — they deserve tabular figures, weight, and size;
   labels recede to 11–12px uppercase tracking; headings earn their weight.
3. **Unfinished primitives.** Native `<select>`s with zero styling in the
   assignment table and members page; default checkbox on settings. A
   product is judged by its lowest-polish control.
4. **No motion identity.** transition-all 200ms everywhere = nothing feels
   designed. Motion should be rare, physical (ease-out-quart, 150–250ms),
   and meaningful (state change, not hover noise).
5. **Mobile chrome is a port, not a design.** Bottom tabs exist but lack
   iOS-native affordances: precise blur/opacity stack, hairline border,
   active transitions, safe-area padding tuned, larger touch targets.

## 2. The language — restraint, depth, precision

**Surfaces (the core system).** Three levels, defined once as tokens:

- `surface-0` app canvas: near-black green-tinted neutral (dark) /
  paper-warm white (light). The gradient mesh survives ONLY here, at 4-6%
  intensity — texture, not decor.
- `surface-1` cards/panels: OPAQUE elevated surface + 1px hairline
  (`border-white/8` dark, `border-black/6` light) + shadow-sm. Glass is
  RETIRED for content surfaces.
- `surface-2` overlays (popovers/menus/dialogs): opaque `bg-popover`,
  hairline, shadow-lg + 12px backdrop-blur applied to the LAYER BEHIND
  (scrim), never to the panel's own background. Text never sits on
  transparency.

**Type.** Geist stays (brand). Scale: 24/18/15/13/11. Money/metrics ALWAYS
`tabular-nums`, medium+ weight, never muted. Labels: 11px, tracking-wide,
60% foreground. One accent weight per view.

**Color.** Emerald reserved for: primary action, active nav, positive
state. Everything else is neutral scale + two semantic hues (amber warn,
red critical). No accent gradients on surfaces; the 135° emerald gradient
lives EXCLUSIVELY on primary buttons (brand signature).

**Geometry.** Radii: 10px controls (brand), 14px cards, 20px sheets. 8pt
spacing grid, 4pt inside controls. Hairlines everywhere borders exist —
never 2px, never `border-border` at full strength on dark.

**Motion.** 150ms ease-out for state, 250ms cubic-bezier(0.16,1,0.3,1) for
surfaces entering; nothing animates on hover except color/opacity. Reduced
motion honored globally.

**Density.** Desktop = data cockpit (13px rows OK). Mobile = iOS app: 16px
base, 44pt touch targets, generous whitespace, one column, cards over
tables everywhere below md.

## 3. Immediate defects (called out, fix first)

- Notification popover: overflows viewport on small screens; too
  transparent. → clamp `w-[min(24rem,calc(100vw-1.5rem))]`, right-align
  within viewport, opaque `bg-popover` + hairline + shadow-lg.
- Native selects (assignment form family/entity, members role) — style as
  first-class `Select` control: surface-2 menu, 13px rows, check glyph,
  keyboard nav; keep exact accessible names (X4 e2e contracts).
- Settings checkbox → proper switch control (brand accent, 150ms thumb).
- Top bar on mobile: wordmark + breadcrumb collision fixed properly
  (breadcrumb becomes the mobile title, wordmark only on root pages).

## 4. Execution plan (small PRs, each verified at 375/768/1024/1440)

1. **ui-8 foundations**: tokens (surface/type/motion CSS vars), retire
   glass-card → surface-1, popover fix, Select primitive, Switch
   primitive, focus-visible ring audit. (The two reported bugs die here.)
2. **ui-9 shell**: sidebar + top bar polish (hairlines, active states,
   collapse motion), mobile tab bar to native quality (blur stack,
   hairline, transitions, safe-area).
3. **ui-10 deals home**: the first screen — deal cards with real
   information design (status, momentum, blockers as first-class), empty
   states, skeleton rhythm.
4. **ui-11 workspace**: cockpit polish — toolbar, grid typography
   (tabular), inspector, review queue; mobile summary cards to native
   quality.
5. **ui-12 forms & flows**: upload, assignment, members, settings, auth
   screens — every control on the new primitives.
6. **ui-13 sweep**: 375→1440 walk of EVERY route; screenshot matrix
   committed to the PR; dead styles deleted.

Rules: X4 e2e names preserved per PR (or spec updated in same PR); no
client-math; every PR carries before/after screenshots; Lighthouse a11y
≥ 95 maintained.
