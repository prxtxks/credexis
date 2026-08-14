/**
 * Docs information architecture - one config, consumed by the sidebar and
 * the docs home. Sections grow as features ship; items marked soon render
 * as non-clickable previews (never dead links).
 */

export interface DocsNavItem {
  title: string;
  href?: string;
  soon?: boolean;
}

export interface DocsNavSection {
  label: string;
  items: DocsNavItem[];
}

export const DOCS_NAV: DocsNavSection[] = [
  {
    label: "Getting started",
    items: [
      { title: "What is Credexis?", href: "/docs" },
      { title: "Run a deal end to end", href: "/docs/guides/run-a-deal" },
    ],
  },
  {
    label: "Guides",
    items: [
      { title: "Reviewing extracted values", soon: true },
      { title: "Loan scenarios & pro-forma", soon: true },
      { title: "Branded Excel exports", soon: true },
      { title: "IRS transcript verification", soon: true },
    ],
  },
  {
    label: "Borrower portal",
    items: [
      { title: "Inviting borrowers", soon: true },
      { title: "Document requests", soon: true },
    ],
  },
  {
    label: "Reference",
    items: [
      { title: "Validation gates (G1-G6)", soon: true },
      { title: "Error codes", soon: true },
      { title: "Security & data handling", soon: true },
    ],
  },
];
