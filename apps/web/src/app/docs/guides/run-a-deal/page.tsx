/**
 * The flagship guide: run one real deal end to end. Every name and number
 * is from Golden Deal 1 (Travelodge Merrill acquisition) - the deal the
 * engine's acceptance test reproduces against the bank's own workbook.
 * Written for a reader with no finance background.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { Callout, Step, UI, ValueTable } from "../../_components/docs-ui";
import { Toc } from "../../_components/toc";

export const metadata: Metadata = {
  title: "Run a deal end to end",
  description:
    "Create a deal, upload documents, review extracted values, project the pro-forma, and export the banker workbook - walked through on a real hotel acquisition.",
};

const TOC = [
  { id: "overview", title: "What you are about to do" },
  { id: "before", title: "Before you start" },
  { id: "create", title: "1 - 4 · Set the deal up" },
  { id: "process", title: "5 - 7 · Let it read, then review" },
  { id: "model", title: "8 - 9 · Model the loan" },
  { id: "export", title: "10 · Export the workbook" },
  { id: "meaning", title: "What the numbers mean" },
  { id: "verify", title: "How to check the system" },
];

export default function RunADealGuide() {
  return (
    <div className="flex gap-10 py-10 pl-0 md:pl-10">
      <main className="min-w-0 max-w-3xl flex-1">
        <nav className="text-muted-foreground text-[12.5px]">
          <Link href="/docs" className="hover:text-foreground transition-colors">
            Docs
          </Link>
          <span className="mx-1.5">/</span>
          <span>Guides</span>
          <span className="mx-1.5">/</span>
          <span className="text-foreground">Run a deal end to end</span>
        </nav>

        <h1 className="text-foreground mt-3 text-[30px] leading-tight font-bold tracking-tight">
          Run a deal end to end
        </h1>
        <p className="text-muted-foreground mt-3 text-[15px] leading-7">
          This guide walks through one real deal - a buyer acquiring the{" "}
          <strong className="text-foreground">Travelodge by Wyndham in Merrill, Wisconsin</strong> -
          from an empty deal to a finished, branded Excel workbook. Follow it with your own deal's
          documents, or use the names and numbers here as a worked example you can check against.
        </p>

        {/* ── Overview ── */}
        <h2
          id="overview"
          className="text-foreground mt-12 scroll-mt-24 text-[20px] font-bold tracking-tight"
        >
          What you are about to do
        </h2>
        <p className="text-muted-foreground mt-2 text-[14px] leading-7">
          An SBA lender needs to answer one question:{" "}
          <strong className="text-foreground">
            will this business make enough cash to pay back the loan?
          </strong>{" "}
          Answering it means pulling hundreds of numbers out of tax returns and financial
          statements, organizing them, adjusting them, and projecting them forward. Credexis does
          the reading and the math; you make the judgment calls. The flow is:
        </p>
        <p className="text-muted-foreground mt-3 text-[13.5px] leading-7">
          <span className="text-foreground font-medium">
            Create the deal → add the parties → upload documents → assign them → the pipeline reads
            everything → you review what it found → set up the loan → read the pro-forma → export.
          </span>
        </p>

        {/* ── Before you start ── */}
        <h2
          id="before"
          className="text-foreground mt-12 scroll-mt-24 text-[20px] font-bold tracking-tight"
        >
          Before you start
        </h2>
        <ul className="text-muted-foreground mt-2 list-disc space-y-1.5 pl-5 text-[14px] leading-7">
          <li>A Credexis login with the underwriter role (ask your workspace admin).</li>
          <li>
            The deal&apos;s documents as PDFs. For this deal that is 29 files: the target
            hotel&apos;s tax returns, P&amp;Ls and balance sheet, both buyers&apos; personal
            returns, and returns for the businesses the buyers already own.
          </li>
          <li>
            The loan ask. Here: <strong className="text-foreground">$1,700,000</strong>, 25 years,
            10.25% - an SBA 7(a) acquisition loan.
          </li>
        </ul>
        <Callout kind="info" title="Scanned documents are fine">
          Native PDFs and scans both work. The system renders scanned pages to images and reads them
          visually - a skewed fax-quality filed copy went through this same pipeline.
        </Callout>

        {/* ── Steps 1-4 ── */}
        <h2
          id="create"
          className="text-foreground mt-12 scroll-mt-24 text-[20px] font-bold tracking-tight"
        >
          Set the deal up
        </h2>

        <Step n={1} title="Create the deal">
          <p>
            From the dashboard, start a new deal. The wizard has three quick steps -{" "}
            <UI>Loan type</UI>, <UI>Deal &amp; parties</UI>, <UI>Review</UI>:
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              Loan type: <UI>SBA 7(a)</UI> - a business acquisition.
            </li>
            <li>
              Deal name: <UI>Travelodge Merrill acquisition</UI>. Name deals so a colleague can find
              them: property or business, then what is happening to it.
            </li>
            <li>
              Applicant legal name: <UI>Niyazi Hotels &amp; Resorts Inc</UI> - the company that owns
              the hotel.
            </li>
          </ul>
        </Step>

        <Step n={2} title="Add every party to the deal">
          <p>
            A deal is more than one company. SBA underwriting looks at the <strong>target</strong>{" "}
            (the business being bought), each <strong>guarantor</strong> (the people promising to
            repay if the business cannot), and every <strong>operating company</strong> the
            guarantors already run (their other income and obligations count too). This deal has
            six:
          </p>
          <ValueTable
            head={["Entity", "Role"]}
            rows={[
              ["Niyazi Hotels & Resorts Inc", "Target"],
              ["Rimpal Patel", "Guarantor"],
              ["Mittal Patel", "Guarantor"],
              ["Jai Mata Di LLC", "Operating company"],
              ["Shiv Ganesha 1008 LLC", "Operating company"],
              ["Prayosha Inc", "Operating company"],
            ]}
          />
        </Step>

        <Step n={3} title="Upload the documents">
          <p>
            Drag all 29 PDFs into the deal&apos;s Documents area at once. For each entity you want,
            where available: 3 years of business tax returns, current-year and prior-year P&amp;Ls,
            a recent balance sheet, and 4 years of personal returns per guarantor. Do not worry
            about which file belongs to whom yet - that is the next step. Multi-form PDFs (a tax
            return with its schedules, or a state return stapled behind the federal one) are split
            automatically.
          </p>
        </Step>

        <Step n={4} title="Assign each document to its entity">
          <p>
            The system proposes what each document is (&quot;1120-S, tax year 2024&quot;) - you
            confirm who it belongs to. Pick the entity from the dropdown on each row,{" "}
            <strong>
              then press the row&apos;s <UI>Save</UI> button
            </strong>
            . Extraction starts the moment an assignment is saved, per document - you will see the
            first results while you are still assigning the rest.
          </p>
          <Callout kind="warn">
            Choosing from the dropdown stages a draft; only <strong>Save</strong> commits it. A row
            without a saved assignment is never extracted.
          </Callout>
        </Step>

        {/* ── Steps 5-7 ── */}
        <h2
          id="process"
          className="text-foreground mt-12 scroll-mt-24 text-[20px] font-bold tracking-tight"
        >
          Let it read, then review
        </h2>

        <Step n={5} title="Watch the pipeline work">
          <p>
            The workspace rail shows the deal moving <UI>Intake</UI> → <UI>Parsing</UI> →{" "}
            <UI>Review</UI>. Under the hood every page is classified, every form is read by two
            independent methods whose answers are compared, and every number is checked against the
            arithmetic printed on the form itself. This deal - about 480 pages - produced roughly
            1,000 extracted values across the six entities.
          </p>
          <p>
            If a document cannot be processed, the deal does not silently move on: the document
            shows a plain-language failure notice with the technical error, a link to the docs, and
            a one-click <UI>Re-run extraction</UI>.
          </p>
        </Step>

        <Step n={6} title="Review what it found">
          <p>
            The review queue lists every value with a confidence and a status. The rule of the
            product:{" "}
            <strong>the system never guesses - anything it is not sure about waits for you</strong>.
            Values from financial statements always arrive as suggestions for you to accept;
            high-confidence tax-form values arrive pre-accepted with their evidence attached.
          </p>
          <p>
            Every accepted value shows a green mark. Click it: the source PDF opens on the exact
            page with the exact box highlighted. That link to the page never goes away - it is what
            makes the final workbook defensible in an audit.
          </p>
        </Step>

        <Step n={7} title="Clear the issues">
          <p>
            The Issues panel is the deal&apos;s conscience. Validation gates check that extracted
            components add up to printed totals, that values tie across forms, and (when IRS
            transcript verification is enabled) that what the borrower filed matches what the IRS
            has on record. A critical issue blocks the affected value from being trusted until a
            human resolves it - that is deliberate.
          </p>
        </Step>

        {/* ── Steps 8-9 ── */}
        <h2
          id="model"
          className="text-foreground mt-12 scroll-mt-24 text-[20px] font-bold tracking-tight"
        >
          Model the loan
        </h2>

        <Step n={8} title="Create the loan scenario">
          <p>Add a scenario with the deal&apos;s actual structure:</p>
          <ValueTable
            head={["Setting", "Value"]}
            rows={[
              ["Scenario name", "SBA 7(a) - $1.7M / 25y / 10.25%"],
              ["Loan amount", "$1,700,000"],
              ["Term", "300 months (25 years)"],
              ["Rate", "10.25% fixed"],
              ["Equity injection", "$190,000"],
              ["Replacement salary", "$60,000 / year"],
            ]}
          />
          <p>
            The <strong>equity injection</strong> is the cash the buyers put in themselves (SBA
            requires roughly 10% on a change of ownership). The <strong>replacement salary</strong>{" "}
            is what it will cost to pay someone to do the job the departing owner was doing - more
            on why below.
          </p>
        </Step>

        <Step n={9} title="Read the pro-forma">
          <p>
            Open the <UI>Pro-Forma</UI> tab. The engine anchors on a <strong>base period</strong> -
            here the hotel&apos;s January-September 2025 P&amp;L - and projects three years forward.
            Two things to check on this deal:
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              Base period <UI>2025 Jan-Sep</UI> with <UI>Months covered: 9</UI>. Nine months of
              revenue was <strong>$348,517.71</strong>; the engine annualizes it to{" "}
              <strong>$464,690.28</strong> (× 12 ÷ 9, to the cent).
            </li>
            <li>
              Each expense line has a <strong>treatment</strong>: scale with revenue (
              <UI>% of revenue</UI>), stay flat (<UI>Fixed</UI> - rent, insurance), or drop out (
              <UI>Excluded</UI> - the old owner&apos;s costs that will not recur).
            </li>
          </ul>
          <p>
            Any number built from more than one source line shows a small count next to it - click
            it to see exactly which printed lines were combined, with their pages. Adjust growth
            assumptions per year, then <UI>Save assumptions</UI>: the saved record is part of the
            audit trail, so a reviewer can always see which assumptions produced which numbers.
          </p>
        </Step>

        {/* ── Step 10 ── */}
        <h2
          id="export"
          className="text-foreground mt-12 scroll-mt-24 text-[20px] font-bold tracking-tight"
        >
          Export the workbook
        </h2>

        <Step n={10} title="Brand it and export">
          <p>
            In <UI>Settings → Export &amp; Brand</UI>, set your institution&apos;s name, colors, and
            logo once - every workbook the workspace exports carries them. Then, from the deal,{" "}
            <UI>Export .xlsx</UI>. The workbook contains the tabs a credit committee expects:{" "}
            <strong>Spread</strong> (the financials, year by year), <strong>Addbacks</strong>,{" "}
            <strong>Global CF</strong> (business + guarantors together), <strong>Pro-Forma</strong>,
            and <strong>Assumptions</strong> (every assumption and version stamped - the audit trail
            travels with the file).
          </p>
        </Step>

        {/* ── What the numbers mean ── */}
        <h2
          id="meaning"
          className="text-foreground mt-14 scroll-mt-24 text-[20px] font-bold tracking-tight"
        >
          What the numbers mean (no finance degree required)
        </h2>
        <div className="text-muted-foreground mt-3 space-y-4 text-[14px] leading-7 [&_strong]:text-foreground">
          <p>
            <strong>Revenue</strong> is everything the hotel took in - room rentals, mostly.{" "}
            <strong>Operating expenses</strong> is what it cost to run - wages, utilities, franchise
            fees, repairs. Revenue minus operating expenses is{" "}
            <strong>NOI (net operating income)</strong>: profit from running the business.
          </p>
          <p>
            <strong>Add-backs</strong> are the underwriter&apos;s adjustments. Some expenses on the
            tax return will not exist for the new owner, so they are &quot;added back&quot; to
            profit: <strong>depreciation</strong> (a paper expense - no cash leaves),{" "}
            <strong>interest</strong> (the old owner&apos;s loans are being paid off),{" "}
            <strong>the old owner&apos;s salary</strong> (they are leaving). But the business still
            needs a manager - so a realistic <strong>replacement salary</strong> ($60,000 here) is
            subtracted back out. This is why the field exists in the scenario.
          </p>
          <p>
            What is left is <strong>CFADS - cash flow available for debt service</strong>: the cash
            the business can actually use to pay the loan each year. <strong>Debt service</strong>{" "}
            is what the loan costs per year - for $1.7M over 25 years at 10.25%, about $15,700 a
            month. The app computes the exact amortized figure.
          </p>
          <p>
            <strong>DSCR - the number the whole deal turns on</strong> - is CFADS divided by debt
            service. DSCR 1.0 means the business earns exactly its loan payment: no cushion. SBA
            policy generally requires at least <strong>1.15</strong>; most lenders want{" "}
            <strong>1.25 or better</strong>, meaning at least a 25% cushion. The pro-forma shows
            DSCR per projected year, colored by whether it clears the bar. Those thresholds come
            from the versioned SBA policy pack in the product, not from anyone&apos;s memory.
          </p>
          <p>
            <strong>Why compute all this?</strong> Because every bank does - by hand, in
            spreadsheets, differently each time. Credexis makes the same analysis fast, consistent,
            and traceable: every input has a page it came from, every assumption has a record, every
            threshold has a policy version.
          </p>
        </div>

        {/* ── How to check ── */}
        <h2
          id="verify"
          className="text-foreground mt-14 scroll-mt-24 text-[20px] font-bold tracking-tight"
        >
          How to check the system is right
        </h2>
        <div className="text-muted-foreground mt-3 space-y-4 text-[14px] leading-7 [&_strong]:text-foreground">
          <p>Do not trust it - check it. This deal gives you known answers to check against:</p>
          <ValueTable
            caption="Spot-checks from this deal's documents (all findable in the source viewer)"
            head={["Check", "Expected"]}
            rows={[
              ["Hotel P&L FY2024 - Total Income", "$501,105.00"],
              ["Hotel P&L FY2024 - Total Expense", "$237,942.00"],
              ["Hotel P&L FY2024 - Net Income", "$208,869.00"],
              ["1120-S 2024, line 1c (gross receipts)", "$501,105"],
              ["1120-S 2024, line 14 = Form 4562 line 22", "$21,125"],
              ["Base revenue annualized: $348,517.71 × 12 ÷ 9", "$464,690.28"],
            ]}
          />
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong>Click the green marks.</strong> Any accepted value must show you the exact box
              on the exact page. If a number cannot show you its page, do not use it.
            </li>
            <li>
              <strong>Cross-foot a statement.</strong> Pick the FY2024 P&amp;L: income minus expense
              should equal the printed net income to the penny ($501,105.00 − $237,942.00 − other
              items = $208,869.00). The gates check this automatically; check it once yourself
              anyway.
            </li>
            <li>
              <strong>Tie the books to the tax return.</strong> The P&amp;L&apos;s revenue and the
              1120-S line 1c should agree ($501,105). When they do not, that is not a bug - that is
              a question for the borrower, and exactly what the Issues panel is for.
            </li>
            <li>
              <strong>Recompute one thing by hand.</strong> The annualization (× 12 ÷ 9) or DSCR
              (CFADS ÷ annual debt service) take thirty seconds on a calculator and prove the
              engine&apos;s arithmetic end to end.
            </li>
            <li>
              <strong>Notice what it refuses to do.</strong> A line that mixes two categories, a
              blurry number, a value the two reading methods disagree on - these wait in review
              rather than being guessed. If you ever see the system invent a number it cannot
              source, that is a bug: report it from the Support page.
            </li>
          </ul>
        </div>

        <div className="border-border mt-14 border-t pt-6 pb-16">
          <Link
            href="/docs"
            className="text-primary text-[13.5px] font-medium transition-opacity hover:opacity-80"
          >
            ← Back to all docs
          </Link>
        </div>
      </main>

      <aside className="sticky top-24 hidden h-fit w-52 shrink-0 self-start xl:block">
        <Toc entries={TOC} />
      </aside>
    </div>
  );
}
