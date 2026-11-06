import type { Metadata } from "next";

import { ThemeToggle } from "@/components/theme-toggle";
import { RunInspector, type RunSpan } from "@/components/ui/run-inspector";

export const metadata: Metadata = {
  title: "Run inspector",
  description: "Trace of an agent run: every agent, LLM call and tool call on one timeline.",
};

// Sample data: this repo has no stored agent-run or trace data to adapt yet.
const run: RunSpan = {
  id: "main",
  name: "Orchestrator",
  kind: "agent",
  status: "running",
  start: 0,
  model: "Opus 5.5",
  task: "Launch the new pricing page by Friday",
  children: [
    {
      id: "plan",
      name: "Plan the launch",
      kind: "llm",
      status: "done",
      start: 200,
      end: 7100,
      model: "Opus 5.5",
      tokensIn: 6200,
      tokensOut: 900,
      cost: 0.03,
    },
    {
      id: "coder",
      name: "Coder",
      kind: "agent",
      status: "running",
      start: 7400,
      model: "GPT-6 Sol",
      task: "Build the page",
      children: [
        {
          id: "tests",
          name: "Run checkout tests",
          kind: "tool",
          status: "failed",
          start: 9000,
          end: 17400,
          tool: "run_tests",
          args: { command: "pnpm test checkout" },
          error: "2 of 14 checkout tests fail",
        },
      ],
    },
  ],
};

export default function RunPage() {
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Run inspector</h1>
          <p className="text-sm text-muted-foreground">
            Every agent, LLM call and tool call in this run, on one timeline.
          </p>
        </div>
        <ThemeToggle />
      </div>
      <RunInspector run={run} />
    </main>
  );
}
