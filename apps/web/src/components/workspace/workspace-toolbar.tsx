"use client";

/**
 * Workspace toolbar (ui-3): V1's frosted app chrome — back arrow, mini
 * logo, deal identity, segmented panel controls, export, theme — over
 * the V2 three-zone layout (all zones stay simultaneously visible; V1's
 * mutually-exclusive panel was a postmortem finding).
 */

import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  Download,
  FileSearch,
  PanelLeft,
  PanelLeftClose,
  PanelRight,
  PanelRightClose,
  SlidersHorizontal,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";

export type InspectorTab = "source" | "issues" | "scenario";

const INSPECTOR_TABS: { key: InspectorTab; label: string; icon: typeof FileSearch }[] = [
  { key: "source", label: "Source", icon: FileSearch },
  { key: "issues", label: "Issues", icon: AlertTriangle },
  { key: "scenario", label: "Scenario", icon: SlidersHorizontal },
];

export function WorkspaceToolbar({
  dealName,
  dealType,
  exportHref,
  railOpen,
  panelOpen,
  inspectorTab,
  issuesCount,
  onToggleRail,
  onTogglePanel,
  onInspectorTab,
}: {
  dealName: string;
  dealType: string;
  exportHref: string;
  railOpen: boolean;
  panelOpen: boolean;
  inspectorTab: InspectorTab;
  issuesCount: number;
  onToggleRail: () => void;
  onTogglePanel: () => void;
  onInspectorTab: (tab: InspectorTab) => void;
}) {
  return (
    <header className="frosted-toolbar z-30 flex h-14 shrink-0 items-center gap-2 px-3">
      <Button asChild variant="ghost" size="icon" className="h-9 w-9 rounded-full shrink-0">
        <Link href="/" aria-label="Back to deals">
          <ArrowLeft className="h-4 w-4" />
        </Link>
      </Button>
      <Logo size="sm" />
      <div className="mx-1 h-6 w-px bg-border" />
      <h1 className="truncate text-sm font-semibold">{dealName}</h1>
      <Badge variant="secondary" className="rounded-full font-normal shrink-0">
        {dealType.replaceAll("_", " ")}
      </Badge>

      <div className="ml-auto flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 rounded-full"
          aria-label={railOpen ? "Collapse rail" : "Expand rail"}
          onClick={onToggleRail}
        >
          {railOpen ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeft className="h-4 w-4" />}
        </Button>

        {/* Inspector segmented pills (V1 panel-toggle language) */}
        <div className="flex items-center gap-0.5 rounded-full bg-muted/60 p-0.5">
          {INSPECTOR_TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => onInspectorTab(t.key)}
              className={cn(
                "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                inspectorTab === t.key && panelOpen
                  ? "bg-card text-primary shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <t.icon className="h-3.5 w-3.5" />
              {t.label}
              {t.key === "issues" && issuesCount > 0 ? ` (${issuesCount})` : ""}
            </button>
          ))}
        </div>

        <Button
          asChild
          variant="outline"
          size="sm"
          className="rounded-full"
          title="Download banker workbook (.xlsx)"
        >
          <a href={exportHref}>
            <Download className="mr-1.5 h-3.5 w-3.5" />
            XLSX
          </a>
        </Button>

        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 rounded-full"
          aria-label={panelOpen ? "Collapse inspector" : "Expand inspector"}
          onClick={onTogglePanel}
        >
          {panelOpen ? <PanelRightClose className="h-4 w-4" /> : <PanelRight className="h-4 w-4" />}
        </Button>
        <ThemeToggle />
      </div>
    </header>
  );
}
