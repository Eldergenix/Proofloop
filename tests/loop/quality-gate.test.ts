import { expect, mock, test } from "bun:test";
import { REVIEW_FAIL, REVIEW_PASS } from "../../src/loop/constants";
import {
  buildQualityReviewPrompt,
  createRunQualityGate,
} from "../../src/loop/quality-gate";
import type { Options, QualityGateMode, RunResult } from "../../src/loop/types";

const makeOptions = (
  qualityGate: QualityGateMode | undefined = "adversarial"
): Options => ({
  agent: "codex",
  codexModel: "test-model",
  doneSignal: "<done/>",
  format: "raw",
  maxIterations: 2,
  proof: "verify with tests",
  qualityGate,
});

const passCommand = {
  args: ["bun", "test"],
  name: "tests",
};

const runResult = (parsed: string): RunResult => ({
  combined: "",
  exitCode: 0,
  parsed,
});

test("buildQualityReviewPrompt includes adversarial security and performance standards", () => {
  const prompt = buildQualityReviewPrompt(
    "ship feature",
    makeOptions(),
    "codex",
    [{ command: passCommand, exitCode: 0, output: "ok" }]
  );

  expect(prompt).toContain("Adversarial quality review mode");
  expect(prompt).toContain("Security standards");
  expect(prompt).toContain("Performance standards");
  expect(prompt).toContain("Quality commands already run");
  expect(prompt).toContain(REVIEW_FAIL);
  expect(prompt).toContain(REVIEW_PASS);
});

test("runQualityGate is disabled unless adversarial mode is set", async () => {
  const runCommand = mock(async () => ({
    command: passCommand,
    exitCode: 0,
    output: "",
  }));
  const runReviewer = mock(async () => runResult(REVIEW_PASS));
  const gate = createRunQualityGate({
    commands: [passCommand],
    runCommand,
    runReviewer,
  });

  const result = await gate(["codex"], "ship feature", makeOptions("none"));

  expect(result.approved).toBe(true);
  expect(result.commandResults).toEqual([]);
  expect(runCommand).not.toHaveBeenCalled();
  expect(runReviewer).not.toHaveBeenCalled();
});

test("runQualityGate fails before reviewer when a command fails", async () => {
  const runCommand = mock(async () => ({
    command: passCommand,
    exitCode: 1,
    output: "test failed",
  }));
  const runReviewer = mock(async () => runResult(REVIEW_PASS));
  const gate = createRunQualityGate({
    commands: [passCommand],
    runCommand,
    runReviewer,
  });

  const result = await gate(["codex"], "ship feature", makeOptions());

  expect(result.approved).toBe(false);
  expect(result.notes).toContain("Quality gate command failures");
  expect(result.notes).toContain("test failed");
  expect(runReviewer).not.toHaveBeenCalled();
});

test("runQualityGate runs adversarial review after commands pass", async () => {
  const runCommand = mock(async () => ({
    command: passCommand,
    exitCode: 0,
    output: "ok",
  }));
  const runReviewer = mock(async () =>
    runResult(`Looks risky.\n${REVIEW_FAIL}`)
  );
  const gate = createRunQualityGate({
    commands: [passCommand],
    runCommand,
    runReviewer,
  });

  const result = await gate(["codex"], "ship feature", makeOptions());

  expect(result.approved).toBe(false);
  expect(result.notes).toContain("Looks risky.");
  expect(runCommand).toHaveBeenCalledTimes(1);
  expect(runReviewer).toHaveBeenCalledTimes(1);
});
