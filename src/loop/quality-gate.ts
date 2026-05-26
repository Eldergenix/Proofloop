import { spawn } from "bun";
import { REVIEW_FAIL, REVIEW_PASS } from "./constants";
import { createRunReviewWithPrompt } from "./review";
import { runReviewerAgent } from "./runner";
import type { Agent, Options, ReviewResult, RunResult } from "./types";

type BunReadableStream = ReadableStream<Uint8Array<ArrayBufferLike>>;
type RunAgentFn = (
  agent: Agent,
  prompt: string,
  opts: Options
) => Promise<RunResult>;
type RunCommandFn = (
  command: QualityGateCommand
) => Promise<QualityGateCommandResult>;
type BuildPromptFn = (
  task: string,
  opts: Options,
  reviewer: Agent | undefined,
  commandResults: QualityGateCommandResult[]
) => string;

export interface QualityGateCommand {
  args: string[];
  name: string;
}

export interface QualityGateCommandResult {
  command: QualityGateCommand;
  exitCode: number;
  output: string;
}

export interface QualityGateResult {
  approved: boolean;
  commandResults: QualityGateCommandResult[];
  notes: string;
  review?: ReviewResult;
}

interface QualityGateDeps {
  buildPrompt?: BuildPromptFn;
  commands?: QualityGateCommand[];
  runCommand?: RunCommandFn;
  runReviewer?: RunAgentFn;
}

const MAX_OUTPUT_CHARS = 4000;
const QUALITY_GATE_DISABLED: QualityGateResult = {
  approved: true,
  commandResults: [],
  notes: "",
};

export const DEFAULT_QUALITY_GATE_COMMANDS: QualityGateCommand[] = [
  { args: ["bun", "run", "check"], name: "lint and format" },
  { args: ["bun", "run", "typecheck"], name: "runtime typecheck" },
  { args: ["bun", "test"], name: "tests" },
  { args: ["bun", "run", "build"], name: "build" },
];

const commandText = (command: QualityGateCommand): string =>
  command.args.join(" ");

const asReadableStream = (
  stream: ReturnType<typeof spawn>["stdout"],
  name: string
): BunReadableStream => {
  if (stream instanceof ReadableStream) {
    return stream as BunReadableStream;
  }
  throw new Error(`quality gate ${name} stream is unavailable`);
};

const readStream = async (stream: BunReadableStream): Promise<string> => {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (value) {
        text += decoder.decode(value, { stream: true });
      }
    }
    text += decoder.decode();
  } finally {
    reader.releaseLock();
  }

  return text.trim();
};

const trimOutput = (output: string): string => {
  const trimmed = output.trim();
  if (trimmed.length <= MAX_OUTPUT_CHARS) {
    return trimmed;
  }
  return `${trimmed.slice(0, MAX_OUTPUT_CHARS)}\n[truncated]`;
};

export const runQualityGateCommand = async (
  command: QualityGateCommand
): Promise<QualityGateCommandResult> => {
  const proc = spawn(command.args, {
    env: process.env,
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    readStream(asReadableStream(proc.stdout, "stdout")),
    readStream(asReadableStream(proc.stderr, "stderr")),
    proc.exited,
  ]);
  return {
    command,
    exitCode,
    output: trimOutput([stdout, stderr].filter(Boolean).join("\n")),
  };
};

const formatCommandFailures = (results: QualityGateCommandResult[]): string => {
  const failures = results.filter((result) => result.exitCode !== 0);
  if (failures.length === 0) {
    return "";
  }

  return [
    "Quality gate command failures:",
    ...failures.map((result) =>
      [
        `[${result.command.name}] \`${commandText(result.command)}\` exited with code ${result.exitCode}.`,
        result.output,
      ]
        .filter(Boolean)
        .join("\n")
    ),
  ].join("\n\n");
};

const formatCommandSummary = (results: QualityGateCommandResult[]): string =>
  results
    .map(
      (result) =>
        `- ${result.exitCode === 0 ? "pass" : "fail"}: ${result.command.name} (\`${commandText(result.command)}\`)`
    )
    .join("\n");

export const buildQualityReviewPrompt: BuildPromptFn = (
  task,
  opts,
  _reviewer,
  commandResults
) => {
  const parts = [
    "Adversarial quality review mode:",
    `Task:\n${task.trim()}`,
    "Review the completed work before the loop can close. Be hostile to weak proof, hidden regressions, and happy-path-only claims.",
    "Inspect changed files with `git diff --stat` and `git diff` when available. If git is unavailable, say so and inspect the task-relevant files directly.",
    "Security standards: look for command injection, path traversal, unsafe file writes or deletes, secret leakage, auth/session mistakes, subprocess/env abuse, dependency/update risks, and unsafe defaults.",
    "Performance standards: look for unbounded loops, runaway retries, process leaks, socket/timer leaks, memory growth, expensive startup work, avoidable serial waits, and noisy repeated work.",
    "Verification standards: challenge whether the checks actually cover the changed behavior. Missing, skipped, stale, or too-narrow proof is a failure.",
    `Quality commands already run:\n${formatCommandSummary(commandResults)}`,
  ];

  if (opts.proof.trim()) {
    parts.push(`Proof requirements:\n${opts.proof.trim()}`);
  }

  parts.push(
    `If any security, performance, correctness, or proof issue remains, end with exactly "${REVIEW_FAIL}" on the final non-empty line. Nothing may follow this line.`
  );
  parts.push(
    `If the work is complete and the quality bar is met, end with exactly "${REVIEW_PASS}" on the final non-empty line. No extra content after this line.`
  );
  parts.push(
    `Report concrete file paths, commands, and code locations before the final signal. Do not include "${opts.doneSignal}" in the final signal.`
  );

  return parts.join("\n\n");
};

export const shouldRunQualityGate = (opts: Options): boolean =>
  opts.qualityGate === "adversarial";

export const createRunQualityGate = (deps: QualityGateDeps = {}) => {
  const commands = deps.commands ?? DEFAULT_QUALITY_GATE_COMMANDS;
  const runCommand = deps.runCommand ?? runQualityGateCommand;
  const buildPrompt = deps.buildPrompt ?? buildQualityReviewPrompt;
  const runReviewer = deps.runReviewer ?? runReviewerAgent;

  return async (
    reviewers: Agent[],
    task: string,
    opts: Options
  ): Promise<QualityGateResult> => {
    if (!shouldRunQualityGate(opts)) {
      return QUALITY_GATE_DISABLED;
    }

    console.log("\n[loop] running quality gate commands");
    const commandResults: QualityGateCommandResult[] = [];
    for (const command of commands) {
      console.log(`[loop] quality gate: ${commandText(command)}`);
      commandResults.push(await runCommand(command));
    }

    const commandFailureNotes = formatCommandFailures(commandResults);
    if (commandFailureNotes) {
      return {
        approved: false,
        commandResults,
        notes: commandFailureNotes,
      };
    }

    if (reviewers.length === 0) {
      return {
        approved: true,
        commandResults,
        notes: "",
      };
    }

    const runReview = createRunReviewWithPrompt(
      (reviewTask, reviewOpts, reviewer) =>
        buildPrompt(reviewTask, reviewOpts, reviewer, commandResults),
      runReviewer
    );
    const review = await runReview(reviewers, task, opts);
    return {
      approved: review.approved,
      commandResults,
      notes: review.notes,
      review,
    };
  };
};

export const runQualityGate = createRunQualityGate();
