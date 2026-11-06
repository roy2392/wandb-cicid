"use client";

import * as React from "react";
import {
  BotIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  LoaderCircleIcon,
  SparklesIcon,
  WrenchIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

export type SpanKind = "agent" | "llm" | "tool";
export type SpanStatus = "queued" | "running" | "done" | "failed";

/** One step of an agent run. Times are in ms relative to the start of the run. */
export interface RunSpan {
  id: string;
  name: string;
  kind: SpanKind;
  status: SpanStatus;
  start: number;
  /** Omit while the span is still running. */
  end?: number;
  model?: string;
  /** What an agent span was asked to do. */
  task?: string;
  tokensIn?: number;
  tokensOut?: number;
  /** In US dollars. */
  cost?: number;
  tool?: string;
  args?: Record<string, unknown>;
  result?: unknown;
  error?: string;
  children?: RunSpan[];
}

export interface RunInspectorProps {
  run: RunSpan;
  /**
   * Current time in ms since run start. Leave it out to let the inspector run
   * its own clock while any span is still running.
   */
  now?: number;
  /** Span selected on first render. Defaults to the first failed span, or the root. */
  defaultSelectedId?: string;
  className?: string;
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

interface Totals {
  tokensIn: number;
  tokensOut: number;
  cost: number;
  spans: number;
  failed: number;
  running: number;
}

function walk(span: RunSpan, visit: (s: RunSpan, depth: number) => void, depth = 0) {
  visit(span, depth);
  span.children?.forEach((c) => walk(c, visit, depth + 1));
}

function totalsOf(span: RunSpan): Totals {
  const t: Totals = { tokensIn: 0, tokensOut: 0, cost: 0, spans: 0, failed: 0, running: 0 };
  walk(span, (s) => {
    t.tokensIn += s.tokensIn ?? 0;
    t.tokensOut += s.tokensOut ?? 0;
    t.cost += s.cost ?? 0;
    t.spans += 1;
    if (s.status === "failed") t.failed += 1;
    if (s.status === "running") t.running += 1;
  });
  return t;
}

function latestTime(span: RunSpan): number {
  let max = 0;
  walk(span, (s) => {
    max = Math.max(max, s.start, s.end ?? 0);
  });
  return max;
}

function findSpan(span: RunSpan, id: string): RunSpan | undefined {
  let found: RunSpan | undefined;
  walk(span, (s) => {
    if (!found && s.id === id) found = s;
  });
  return found;
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
}

function formatCost(n: number): string {
  if (n === 0) return "$0";
  if (n < 0.01) return "<$0.01";
  return `$${n.toFixed(2)}`;
}

function niceStep(total: number, targetTicks = 4): number {
  const raw = total / targetTicks;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const n = raw / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}

/* -------------------------------------------------------------------------- */
/* Visual vocab                                                               */
/* -------------------------------------------------------------------------- */

const KIND: Record<SpanKind, { label: string; icon: React.ElementType; chip: string; bar: string }> = {
  agent: {
    label: "Agent",
    icon: BotIcon,
    chip: "bg-violet-500/10 text-violet-700 dark:text-violet-300",
    bar: "bg-violet-500/80 dark:bg-violet-400/80",
  },
  llm: {
    label: "LLM",
    icon: SparklesIcon,
    chip: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
    bar: "bg-sky-500/80 dark:bg-sky-400/80",
  },
  tool: {
    label: "Tool",
    icon: WrenchIcon,
    chip: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
    bar: "bg-amber-500/80 dark:bg-amber-400/80",
  },
};

const STATUS: Record<SpanStatus, { label: string; icon: React.ElementType; className: string }> = {
  queued: { label: "Queued", icon: CircleDashedIcon, className: "text-muted-foreground" },
  running: {
    label: "Running",
    icon: LoaderCircleIcon,
    className: "text-sky-600 dark:text-sky-400 [&_svg]:animate-spin motion-reduce:[&_svg]:animate-none",
  },
  done: { label: "Done", icon: CircleCheckIcon, className: "text-emerald-600 dark:text-emerald-400" },
  failed: { label: "Failed", icon: CircleAlertIcon, className: "text-destructive" },
};

function StatusPill({ status, className }: { status: SpanStatus; className?: string }) {
  const s = STATUS[status];
  const Icon = s.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs font-medium", s.className, className)}>
      <Icon className="size-3.5" aria-hidden />
      {s.label}
    </span>
  );
}

function KindChip({ kind }: { kind: SpanKind }) {
  const k = KIND[kind];
  const Icon = k.icon;
  return (
    <span
      className={cn(
        "inline-flex size-5 shrink-0 items-center justify-center rounded-md",
        k.chip,
      )}
      title={k.label}
    >
      <Icon className="size-3" aria-hidden />
      <span className="sr-only">{k.label}</span>
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Live clock                                                                 */
/* -------------------------------------------------------------------------- */

function useRunClock(run: RunSpan, now: number | undefined): number {
  const base = React.useMemo(() => latestTime(run), [run]);
  const live = now === undefined && totalsOf(run).running > 0;
  const [elapsed, setElapsed] = React.useState(0);

  React.useEffect(() => {
    if (!live) return;
    const t0 = performance.now();
    const id = window.setInterval(() => setElapsed(performance.now() - t0), 200);
    return () => window.clearInterval(id);
  }, [live, base]);

  return now ?? base + (live ? elapsed : 0);
}

/* -------------------------------------------------------------------------- */
/* Component                                                                  */
/* -------------------------------------------------------------------------- */

interface Row {
  span: RunSpan;
  depth: number;
  hasChildren: boolean;
  parentId?: string;
}

export function RunInspector({ run, now, defaultSelectedId, className }: RunInspectorProps) {
  const clock = useRunClock(run, now);
  const totals = React.useMemo(() => totalsOf(run), [run]);

  const [collapsed, setCollapsed] = React.useState<Set<string>>(() => new Set());
  const [selectedId, setSelectedId] = React.useState<string>(() => {
    if (defaultSelectedId) return defaultSelectedId;
    let failed: string | undefined;
    walk(run, (s) => {
      if (!failed && s.status === "failed") failed = s.id;
    });
    return failed ?? run.id;
  });

  const rows = React.useMemo(() => {
    const out: Row[] = [];
    const visit = (span: RunSpan, depth: number, parentId?: string) => {
      const hasChildren = !!span.children?.length;
      out.push({ span, depth, hasChildren, parentId });
      if (hasChildren && !collapsed.has(span.id)) {
        span.children!.forEach((c) => visit(c, depth + 1, span.id));
      }
    };
    visit(run, 0);
    return out;
  }, [run, collapsed]);

  const endOf = (s: RunSpan) => s.end ?? (s.status === "running" ? clock : s.start);
  const total = Math.max(endOf(run), clock, 1);
  const step = niceStep(total);
  const ticks: number[] = [];
  for (let t = 0; t <= total; t += step) ticks.push(t);

  const selected = findSpan(run, selectedId) ?? run;
  const rowRefs = React.useRef(new Map<string, HTMLDivElement>());

  const toggle = (id: string, open?: boolean) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      const isOpen = !next.has(id);
      if (open ?? !isOpen) next.delete(id);
      else next.add(id);
      return next;
    });

  const select = (id: string) => {
    setSelectedId(id);
    rowRefs.current.get(id)?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent, index: number) => {
    const row = rows[index];
    switch (e.key) {
      case "ArrowDown":
        if (rows[index + 1]) select(rows[index + 1].span.id);
        break;
      case "ArrowUp":
        if (rows[index - 1]) select(rows[index - 1].span.id);
        break;
      case "Home":
        select(rows[0].span.id);
        break;
      case "End":
        select(rows[rows.length - 1].span.id);
        break;
      case "ArrowRight":
        if (row.hasChildren && collapsed.has(row.span.id)) toggle(row.span.id, true);
        else if (row.hasChildren) select(row.span.children![0].id);
        break;
      case "ArrowLeft":
        if (row.hasChildren && !collapsed.has(row.span.id)) toggle(row.span.id, false);
        else if (row.parentId) select(row.parentId);
        break;
      case "Enter":
      case " ":
        if (row.hasChildren) toggle(row.span.id);
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  return (
    <section
      className={cn(
        "w-full overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm",
        className,
      )}
      aria-label={`Run inspector: ${run.name}`}
    >
      {/* Header */}
      <header className="flex flex-col gap-3 border-b px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-5">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h2 className="truncate text-base font-semibold">{run.name}</h2>
            <StatusPill status={run.status} />
          </div>
          {run.task && <p className="text-sm text-muted-foreground">{run.task}</p>}
        </div>
        <dl className="grid shrink-0 grid-cols-4 gap-x-5 gap-y-1 text-sm tabular-nums">
          <Stat label="Elapsed" value={formatMs(total)} />
          <Stat label="Spans" value={String(totals.spans)} />
          <Stat label="Tokens" value={formatTokens(totals.tokensIn + totals.tokensOut)} />
          <Stat label="Cost" value={formatCost(totals.cost)} />
        </dl>
      </header>

      <div className="grid lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* Trace */}
        <div className="min-w-0 overflow-x-auto">
          <div className="min-w-[560px]">
            {/* Axis */}
            <div className="grid grid-cols-[minmax(180px,38%)_1fr] border-b text-[11px] text-muted-foreground">
              <div className="px-4 py-2 font-medium sm:px-5">Span</div>
              <div className="relative mr-4 h-full">
                {ticks.map((t) => (
                  <span
                    key={t}
                    className="absolute top-1/2 -translate-y-1/2 tabular-nums"
                    style={{ left: `${(t / total) * 100}%` }}
                  >
                    {formatMs(t)}
                  </span>
                ))}
              </div>
            </div>

            <div role="tree" aria-label="Spans" className="py-1">
              {rows.map((row, i) => {
                const { span, depth, hasChildren } = row;
                const isOpen = hasChildren && !collapsed.has(span.id);
                const isSelected = span.id === selected.id;
                const end = endOf(span);
                const left = (span.start / total) * 100;
                const width = Math.max(((end - span.start) / total) * 100, 0.6);

                return (
                  <div
                    key={span.id}
                    ref={(el) => {
                      if (el) rowRefs.current.set(span.id, el);
                      else rowRefs.current.delete(span.id);
                    }}
                    role="treeitem"
                    aria-level={depth + 1}
                    aria-expanded={hasChildren ? isOpen : undefined}
                    aria-selected={isSelected}
                    tabIndex={isSelected ? 0 : -1}
                    onClick={() => setSelectedId(span.id)}
                    onKeyDown={(e) => onKeyDown(e, i)}
                    className={cn(
                      "group grid cursor-default grid-cols-[minmax(180px,38%)_1fr] items-center outline-none",
                      "hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                      isSelected && "bg-muted",
                    )}
                  >
                    <div
                      className="flex min-w-0 items-center gap-1.5 py-1.5 pr-3"
                      style={{ paddingInlineStart: `calc(${depth} * 1rem + 1rem)` }}
                    >
                      {hasChildren ? (
                        <button
                          type="button"
                          tabIndex={-1}
                          aria-label={isOpen ? "Collapse" : "Expand"}
                          onClick={(e) => {
                            e.stopPropagation();
                            toggle(span.id);
                          }}
                          className="-ml-1 inline-flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground"
                        >
                          <ChevronRightIcon
                            className={cn(
                              "size-3.5 transition-transform motion-reduce:transition-none",
                              isOpen && "rotate-90",
                            )}
                          />
                        </button>
                      ) : (
                        <span className="-ml-1 size-5 shrink-0" />
                      )}
                      <KindChip kind={span.kind} />
                      <span className="truncate text-sm">{span.name}</span>
                      {span.status === "failed" && (
                        <CircleAlertIcon className="size-3.5 shrink-0 text-destructive" aria-label="Failed" />
                      )}
                    </div>

                    <div className="relative mr-4 h-7">
                      {ticks.map((t) => (
                        <span
                          key={t}
                          aria-hidden
                          className="absolute inset-y-0 w-px bg-border/60"
                          style={{ left: `${(t / total) * 100}%` }}
                        />
                      ))}
                      <div
                        className={cn(
                          "absolute top-1/2 h-3 -translate-y-1/2 rounded-sm",
                          span.status === "failed" ? "bg-destructive/85" : KIND[span.kind].bar,
                          span.status === "running" &&
                            "bg-[length:12px_12px] bg-[linear-gradient(135deg,rgb(255_255_255/0.25)_25%,transparent_25%,transparent_50%,rgb(255_255_255/0.25)_50%,rgb(255_255_255/0.25)_75%,transparent_75%)]",
                          span.status === "queued" && "opacity-40",
                        )}
                        style={{ left: `${left}%`, width: `${width}%` }}
                      />
                      <span
                        className="absolute top-1/2 -translate-y-1/2 pl-1.5 text-[11px] text-muted-foreground tabular-nums whitespace-nowrap"
                        style={
                          left + width > 80
                            ? { right: `${100 - left}%`, paddingRight: "0.375rem" }
                            : { left: `${left + width}%` }
                        }
                      >
                        {formatMs(end - span.start)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Details */}
        <SpanDetails span={selected} end={endOf(selected)} />
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

function SpanDetails({ span, end }: { span: RunSpan; end: number }) {
  const t = totalsOf(span);
  const hasChildren = !!span.children?.length;
  const fields: [string, React.ReactNode][] = [
    ["Kind", KIND[span.kind].label],
    ["Status", <StatusPill key="s" status={span.status} />],
    ["Started", `+${formatMs(span.start)}`],
    ["Duration", `${formatMs(end - span.start)}${span.end === undefined && span.status === "running" ? " so far" : ""}`],
  ];
  if (span.model) fields.push(["Model", span.model]);
  if (span.tool) fields.push(["Tool", <code key="t" className="font-mono text-xs">{span.tool}</code>]);
  if (t.tokensIn || t.tokensOut)
    fields.push([
      hasChildren ? "Tokens (incl. children)" : "Tokens",
      `${formatTokens(t.tokensIn)} in · ${formatTokens(t.tokensOut)} out`,
    ]);
  if (t.cost) fields.push([hasChildren ? "Cost (incl. children)" : "Cost", formatCost(t.cost)]);

  return (
    <aside
      aria-label="Span details"
      aria-live="polite"
      className="min-w-0 space-y-4 border-t p-4 sm:p-5 lg:border-t-0 lg:border-l"
    >
      <div className="flex items-center gap-2">
        <KindChip kind={span.kind} />
        <h3 className="truncate text-sm font-semibold">{span.name}</h3>
      </div>

      {span.error && (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {span.error}
        </p>
      )}

      {span.task && (
        <div className="space-y-1">
          <div className="text-[11px] text-muted-foreground">Task</div>
          <p className="text-sm">{span.task}</p>
        </div>
      )}

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        {fields.map(([k, v]) => (
          <React.Fragment key={k}>
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="min-w-0 text-right tabular-nums">{v}</dd>
          </React.Fragment>
        ))}
      </dl>

      {span.args && <JsonBlock label="Arguments" value={span.args} />}
      {span.result !== undefined && <JsonBlock label="Result" value={span.result} />}
    </aside>
  );
}

function JsonBlock({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="space-y-1">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <pre className="overflow-x-auto rounded-md bg-muted px-3 py-2 font-mono text-xs leading-relaxed">
        {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}
