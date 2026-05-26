import { afterEach, expect, mock, test } from "bun:test";
import { resolve } from "node:path";
import type { QualityGateResult } from "../../src/loop/quality-gate";
import type { Options, RunResult } from "../../src/loop/types";

const projectRoot = process.cwd();
const iterationPath = resolve(projectRoot, "src/loop/iteration.ts");
type SingleLoopModule = typeof import("../../src/loop/single-loop");

const makeOptions = (overrides: Partial<Options> = {}): Options => ({
  agent: "codex",
  codexModel: "test-model",
  doneSignal: "<done/>",
  format: "raw",
  maxIterations: 1,
  pairedMode: false,
  proof: "verify",
  ...overrides,
});

const makeResult = (parsed: string): RunResult => ({
  combined: "",
  exitCode: 0,
  parsed,
});

let importNonce = 0;
const tryRunAgent = mock(
  async (
    _agent: string,
    _prompt: string,
    _opts: Options,
    _sessionId?: string
  ): Promise<RunResult> => makeResult("<done/>")
);
const runQualityGate = mock(
  async (): Promise<QualityGateResult> => ({
    approved: true,
    commandResults: [],
    notes: "",
  })
);

const loadSingleLoop = async (): Promise<SingleLoopModule> => {
  mock.module(iterationPath, () => ({
    doneText: (value: string) => `done signal "${value}"`,
    formatFollowUp: mock(() => ({ log: "", notes: "" })),
    iterationCooldown: mock(async () => undefined),
    logIterationHeader: mock(() => undefined),
    logSessionHint: mock(() => undefined),
    tryRunAgent,
  }));
  importNonce += 1;
  const module = (await import(
    `../../src/loop/single-loop.ts?single-loop=${importNonce}`
  )) as SingleLoopModule;
  module.singleLoopInternals.setDeps({ runQualityGate });
  return module;
};

afterEach(() => {
  mock.restore();
  tryRunAgent.mockReset();
  tryRunAgent.mockResolvedValue(makeResult("<done/>"));
  runQualityGate.mockReset();
  runQualityGate.mockResolvedValue({
    approved: true,
    commandResults: [],
    notes: "",
  });
});

test("runSingleLoop uses the resumed session id on the first turn and stops on done", async () => {
  const { runSingleLoop } = await loadSingleLoop();
  const opts = makeOptions({ sessionId: "session-1" });

  await runSingleLoop("Ship feature", opts);

  expect(tryRunAgent).toHaveBeenCalledTimes(1);
  expect(tryRunAgent).toHaveBeenCalledWith(
    "codex",
    expect.stringContaining("Ship feature"),
    opts,
    "session-1"
  );
});

test("runSingleLoop feeds quality gate failures into the next iteration", async () => {
  const { runSingleLoop } = await loadSingleLoop();
  const opts = makeOptions({ maxIterations: 2, qualityGate: "adversarial" });
  runQualityGate
    .mockResolvedValueOnce({
      approved: false,
      commandResults: [],
      notes: "Quality gate command failures:\nmissing test proof",
    })
    .mockResolvedValueOnce({
      approved: true,
      commandResults: [],
      notes: "",
    });

  await runSingleLoop("Ship feature", opts);

  expect(tryRunAgent).toHaveBeenCalledTimes(2);
  expect(tryRunAgent.mock.calls[1]?.[1]).toContain(
    "Quality gate command failures"
  );
});
