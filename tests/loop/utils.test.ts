import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hasSignal, isFile, readPrompt } from "../../src/loop/utils";

test("hasSignal detects exact signal lines with extra whitespace", () => {
  const output = "line one\n   <promise>DONE</promise>   \nline three";

  expect(hasSignal(output, "<promise>DONE</promise>")).toBe(true);
});

test("hasSignal detects quoted signal variants", () => {
  expect(hasSignal('final: "<done/>"', "<done/>")).toBe(true);
  expect(hasSignal('{"done":"<done/>"}', "<done/>")).toBe(true);
});

test("hasSignal avoids substring false positives", () => {
  expect(hasSignal("I decided not to use <done/> yet", "<done/>")).toBe(false);
});

test("hasSignal returns false when signal is missing", () => {
  expect(hasSignal("all good", "<done/>")).toBe(false);
});

test("isFile distinguishes files from directories", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "loop-is-file-"));
  const tempFile = join(tempRoot, "input.txt");
  const tempDir = join(tempRoot, "folder");
  writeFileSync(tempFile, "hello");
  mkdirSync(tempDir);

  try {
    expect(isFile(tempFile)).toBe(true);
    expect(isFile(tempDir)).toBe(false);
    expect(isFile(join(tempRoot, "missing.txt"))).toBe(false);
  } finally {
    rmSync(tempRoot, { force: true, recursive: true });
  }
});

test("readPrompt returns direct text for non-file input", async () => {
  const prompt = await readPrompt("ship the change");

  expect(prompt).toBe("ship the change");
});

test("readPrompt reads file contents when input points to a file", async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "loop-read-prompt-"));
  const tempFile = join(tempRoot, "prompt.txt");
  writeFileSync(tempFile, "prompt from file");

  try {
    const prompt = await readPrompt(tempFile);
    expect(prompt).toBe("prompt from file");
  } finally {
    rmSync(tempRoot, { force: true, recursive: true });
  }
});
