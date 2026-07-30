"use client";

/**
 * Support & feedback (ui-17-support, Pratik 2026-07-30: "i like the way
 * vercel does this. it opens an ai chat" + "feedback/report a bug").
 *
 * UI-first and honest: the chat surface is the map for the future support
 * agent. Until it is wired, the "agent" answers with the truth — a static
 * handoff to the support mailbox (decision D7: one mailbox, one sentence).
 * No fake typing, no invented answers.
 */

import { useState } from "react";
import { ArrowUp, BookOpen, LifeBuoy, Mail } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { FieldSelect } from "@/components/ui/field-select";
import { cn } from "@/lib/utils";

const SUPPORT_EMAIL = "support@credexis.co";

const TOPICS = [
  { value: "question", label: "Question" },
  { value: "bug", label: "Report a bug" },
  { value: "feedback", label: "Feedback" },
  { value: "billing", label: "Billing" },
] as const;

const AGENT_REPLY =
  "The support agent isn't connected yet — this chat is the surface it will " +
  `live in. For now, email ${SUPPORT_EMAIL} with the details below and a ` +
  "human reads every message.";

export default function SupportPage() {
  const [topic, setTopic] = useState<string>("question");
  const [draft, setDraft] = useState("");
  const [thread, setThread] = useState<{ from: "you" | "agent"; text: string }[]>([]);

  function send() {
    const text = draft.trim();
    if (text === "") return;
    setThread((t) => [...t, { from: "you", text }, { from: "agent", text: AGENT_REPLY }]);
    setDraft("");
  }

  const mailHref = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(
    `[${TOPICS.find((t) => t.value === topic)?.label ?? "Support"}] Credexis`,
  )}&body=${encodeURIComponent(
    thread
      .filter((m) => m.from === "you")
      .map((m) => m.text)
      .join("\n\n"),
  )}`;

  return (
    <AppShell breadcrumb="Support">
      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
        <h1 className="text-display">Credexis Support</h1>
        <p className="text-muted-foreground mt-1 text-lg">How can we help you today?</p>

        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          <div className="glass-card cursor-not-allowed rounded-lg p-5 opacity-70">
            <p className="flex items-center gap-2 text-[15px] font-semibold">
              <BookOpen aria-hidden="true" className="text-muted-foreground size-4" />
              Documentation
            </p>
            <p className="text-muted-foreground mt-1 text-[13px]">
              Guides for underwriting, the borrower portal, and exports — being written alongside
              the pilot.
            </p>
          </div>
          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            className="glass-card hover:border-primary/40 rounded-lg p-5 transition-colors duration-150"
          >
            <p className="flex items-center gap-2 text-[15px] font-semibold">
              <Mail aria-hidden="true" className="text-muted-foreground size-4" />
              Email us
            </p>
            <p className="text-muted-foreground mt-1 text-[13px]">
              {SUPPORT_EMAIL} — a human reads every message during the pilot.
            </p>
          </a>
        </div>

        <section className="mt-10">
          <h2 className="text-heading flex items-center gap-2">
            <LifeBuoy aria-hidden="true" className="text-primary size-4" />
            Credexis Agent
          </h2>
          <p className="text-muted-foreground mt-2 text-sm">
            Hello — this is where the support agent will live. Describe the problem; if it
            can&apos;t solve it, it will help you open a case.
          </p>

          {thread.length > 0 ? (
            <div className="mt-4 space-y-3">
              {thread.map((m, i) => (
                <div
                  key={i}
                  className={cn(
                    "max-w-[85%] rounded-lg px-3.5 py-2.5 text-sm",
                    m.from === "you" ? "bg-primary/15 ml-auto" : "glass-card",
                  )}
                >
                  {m.text}
                </div>
              ))}
              <Button asChild size="sm" variant="outline">
                <a href={mailHref}>Create support case by email</a>
              </Button>
            </div>
          ) : null}

          <div className="glass-card mt-4 rounded-lg p-3">
            <FieldSelect
              ariaLabel="Problem area"
              value={topic}
              onChange={setTopic}
              options={TOPICS.map((t) => ({ value: t.value, label: t.label }))}
            />
            <div className="mt-2 flex items-end gap-2">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                placeholder="Send a message…"
                aria-label="Message to support"
                rows={2}
                className="placeholder:text-muted-foreground min-h-16 w-full resize-none bg-transparent text-sm outline-none"
              />
              <button
                type="button"
                aria-label="Send message"
                onClick={send}
                disabled={draft.trim() === ""}
                className="bg-primary flex size-8 shrink-0 items-center justify-center rounded-full text-white transition-opacity disabled:opacity-40"
              >
                <ArrowUp aria-hidden="true" className="size-4" />
              </button>
            </div>
          </div>
          <p className="text-muted-foreground mt-2 text-[11px]">
            The agent is not wired up yet — messages stay on this page until you email them.
          </p>
        </section>
      </main>
    </AppShell>
  );
}
