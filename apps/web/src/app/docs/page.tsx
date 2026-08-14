/**
 * Docs home - what Credexis is, and the doorway into the guides. Sections
 * that are not written yet appear as previews, never dead links.
 */

import Link from "next/link";

const LIVE_CARDS = [
  {
    href: "/docs/guides/run-a-deal",
    title: "Run a deal end to end",
    body: "Create a deal, upload the documents, review every extracted number, project the pro-forma, and export the banker workbook - walked through on a real hotel acquisition.",
    tag: "Guide",
  },
];

const SOON_CARDS = [
  {
    title: "Reviewing extracted values",
    body: "Accept, override, and trace any number back to the exact box on the source page.",
  },
  {
    title: "Loan scenarios & pro-forma",
    body: "Model SBA structures, tune assumptions, and read DSCR like an underwriter.",
  },
  {
    title: "Branded Excel exports",
    body: "Your bank's name, colors, and logo on every workbook that leaves the building.",
  },
  {
    title: "IRS transcript verification",
    body: "Compare what the borrower filed against what the IRS has on record - line by line.",
  },
];

export default function DocsHome() {
  return (
    <main className="py-10 pl-0 md:pl-10">
      <div className="max-w-3xl">
        <p className="text-primary text-[13px] font-semibold tracking-wide uppercase">
          Documentation
        </p>
        <h1 className="text-foreground mt-2 text-[32px] leading-tight font-bold tracking-tight">
          Documents in. Banker-grade analysis out.
        </h1>
        <p className="text-muted-foreground mt-3 text-[15px] leading-7">
          Credexis reads a borrower&apos;s tax returns and financial statements, extracts every
          number with a verifiable link back to the page it came from, and turns them into the
          spreads, cash-flow analysis, and pro-forma an SBA underwriter needs - with a human
          approving anything the system is not certain about.
        </p>

        <div className="mt-10 grid gap-4 sm:grid-cols-2">
          {LIVE_CARDS.map((c) => (
            <Link
              key={c.title}
              href={c.href}
              className="group border-border hover:border-primary/50 relative rounded-xl border p-5 transition-colors"
            >
              <span className="bg-primary/10 text-primary rounded-full px-2 py-0.5 text-[11px] font-semibold">
                {c.tag}
              </span>
              <h2 className="text-foreground group-hover:text-primary mt-3 text-[16px] font-semibold tracking-tight transition-colors">
                {c.title}
              </h2>
              <p className="text-muted-foreground mt-1.5 text-[13.5px] leading-6">{c.body}</p>
              <span className="text-primary mt-3 inline-block text-[13px] font-medium">
                Read the guide →
              </span>
            </Link>
          ))}
          {SOON_CARDS.map((c) => (
            <div key={c.title} className="border-border/60 rounded-xl border border-dashed p-5">
              <span className="border-border text-muted-foreground rounded-full border px-2 py-0.5 text-[11px] font-medium">
                Coming soon
              </span>
              <h2 className="text-muted-foreground mt-3 text-[16px] font-semibold tracking-tight">
                {c.title}
              </h2>
              <p className="text-muted-foreground/70 mt-1.5 text-[13.5px] leading-6">{c.body}</p>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
