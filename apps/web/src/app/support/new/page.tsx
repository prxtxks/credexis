"use client";

/**
 * Support → New case (ui-19, reworded ui-21): two display-size hero lines
 * (second in brand color), help cards, and the agent conversation.
 * Creating a case stores it in this browser (localStorage) and returns to
 * /support; the agent stays an honest stub until it is wired.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUp, BookOpen, Mail } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { FieldSelect } from "@/components/ui/field-select";
import { cn } from "@/lib/utils";
import { CASES_KEY, readCases, type SupportCase } from "@/lib/support-cases";

const SUPPORT_EMAIL = "support@credexis.co";

const TOPICS = [
  { value: "question", label: "Question" },
  { value: "bug", label: "Report a bug" },
  { value: "feedback", label: "Feedback" },
  { value: "billing", label: "Billing" },
] as const;

const AGENT_REPLY =
  "The support agent isn't connected yet - this chat is the surface it will live in. " +
  "Create the case below and a human reads it, or email " +
  SUPPORT_EMAIL +
  " directly.";

export default function SupportNewCasePage() {
  const router = useRouter();
  const [topic, setTopic] = useState<string>("question");
  const [severity, setSeverity] = useState<string>("normal");
  const [draft, setDraft] = useState("");

  // M18: failure notices deep-link here with the incident prefilled
  // (?topic=bug&draft=...). window.location keeps the page prerenderable -
  // useSearchParams would demand a Suspense boundary this app forbids.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const t = q.get("topic");
    if (t && TOPICS.some((x) => x.value === t)) setTopic(t);
    const d = q.get("draft");
    if (d && d.trim() !== "") setDraft(d.slice(0, 2000));
  }, []);
  const [thread, setThread] = useState<{ from: "you" | "agent"; text: string }[]>([]);

  function send() {
    const text = draft.trim();
    if (text === "") return;
    setThread((t) => [...t, { from: "you", text }, { from: "agent", text: AGENT_REPLY }]);
    setDraft("");
  }

  function createCase() {
    const mine = thread.filter((m) => m.from === "you").map((m) => m.text);
    if (mine.length === 0) return;
    const c: SupportCase = {
      id: crypto.randomUUID(),
      title: mine[0]!.slice(0, 80),
      topic: TOPICS.find((t) => t.value === topic)?.label ?? topic,
      severity,
      transcript: mine,
      status: "open",
      createdAt: new Date().toISOString(),
    };
    localStorage.setItem(CASES_KEY, JSON.stringify([c, ...readCases()]));
    router.push("/support");
  }

  return (
    <AppShell breadcrumb="Support · New case">
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <h1 className="text-display">Get help with Credexis</h1>
        <p className="text-display text-primary">What can we sort out for you?</p>

        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          <div className="glass-card cursor-not-allowed rounded-lg p-5 opacity-70">
            <p className="flex items-center gap-2 text-[15px] font-semibold">
              <BookOpen aria-hidden="true" className="text-muted-foreground size-4" />
              Documentation
            </p>
            <p className="text-muted-foreground mt-1 text-[13px]">
              Guides for underwriting, the borrower portal, and exports - being written alongside
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
              {SUPPORT_EMAIL} - a human reads every message during the pilot.
            </p>
          </a>
        </div>

        <section className="mt-10">
          <h2 className="text-heading flex items-center gap-2">
            <span aria-hidden="true" className="bg-primary size-2 rounded-full" />
            Credexis Agent
          </h2>
          <p className="text-muted-foreground mt-2 text-sm">
            Hello - describe the problem. If the agent can&apos;t solve it, it helps you open a
            support case.
          </p>

          {thread.length > 0 ? (
            <div className="mt-4 space-y-3">
              {thread.map((m, i) => (
                <div
                  key={i}
                  className={cn(
                    "w-fit max-w-[75%] rounded-lg px-3.5 py-2.5 text-sm",
                    m.from === "you" ? "bg-primary/15 ml-auto" : "glass-card",
                  )}
                >
                  {m.text}
                </div>
              ))}
            </div>
          ) : null}

          <div className="glass-card mt-4 rounded-lg p-4">
            <div className="flex flex-wrap gap-2 pt-0.5">
              <FieldSelect
                ariaLabel="Problem area"
                value={topic}
                onChange={setTopic}
                options={TOPICS.map((t) => ({ value: t.value, label: t.label }))}
              />
              <FieldSelect
                ariaLabel="Severity level"
                value={severity}
                onChange={setSeverity}
                options={[
                  { value: "low", label: "Low severity" },
                  { value: "normal", label: "Normal severity" },
                  { value: "high", label: "High severity" },
                ]}
              />
            </div>
            <div className="mt-3 flex items-end gap-2">
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

          <div className="mt-3 flex items-center gap-2">
            <Button variant="brand" size="sm" disabled={thread.length === 0} onClick={createCase}>
              Create support case
            </Button>
            <Button asChild variant="ghost" size="sm" className="text-muted-foreground">
              <Link href="/support">Cancel</Link>
            </Button>
          </div>
          <p className="text-muted-foreground mt-2 text-[11px]">
            The agent may make mistakes - today it only hands off. Cases are stored in this browser
            until the case backend lands.
          </p>
        </section>
      </main>
    </AppShell>
  );
}
