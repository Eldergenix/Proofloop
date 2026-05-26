# Proofloop

Proofloop is a Bun CLI for running Claude and Codex in a proof-driven agent loop. It plans work, keeps paired agents coordinated, requires explicit verification, and runs an adversarial security/performance quality gate before a loop can complete.

The repository and package are named **Proofloop**. The installed command remains `loop` for compatibility with the existing CLI, aliases, tmux bridge config, and persisted run state.

Author: [Eldergenix](https://github.com/Eldergenix)  
Repository: [github.com/Eldergenix/proofloop](https://github.com/Eldergenix/proofloop)

## What It Does

- Starts Claude and Codex in paired mode by default.
- Uses one agent as the primary worker and the other as reviewer/support.
- Creates `PLAN.md` from plain-text prompts before execution.
- Persists paired run state under `~/.loop/runs/<repo-id>/<run-id>/`.
- Bridges agent-to-agent messages through Codex App Server and Claude Code Channels.
- Resumes runs by run id, Claude session id, or Codex thread id.
- Optionally runs in tmux and/or a fresh git worktree.
- Blocks completion with an adversarial quality gate unless disabled.

## Completion Standard

Proofloop is built around proof, not optimistic completion messages.

When the worker emits the done signal, Proofloop can run:

1. Standard reviewer pass with Claude, Codex, or both.
2. Quality commands:
   - `bun run check`
   - `bun run typecheck`
   - `bun test`
   - `bun run build`
3. Adversarial security/performance review focused on unsafe file operations, command injection, secret leaks, auth/session mistakes, subprocess abuse, runaway loops, process leaks, memory growth, and weak verification.

The default quality gate is `adversarial`. Use `--quality-gate none` only for fast local experiments.

## Safety

Run Proofloop in a sandbox. The agents can execute commands and are intended for autonomous coding workflows.

Recommended setup:

- Use a VM, container, or disposable development environment.
- Install only the credentials needed for the target repo.
- Prefer fine-grained GitHub tokens.
- Snapshot a known-good environment before long autonomous runs.
- Review generated changes before pushing.

## Requirements

- [Bun](https://bun.com) for source runs and local builds.
- `codex` and/or `claude` installed and authenticated.
- [tmux](https://github.com/tmux/tmux) for paired interactive TUI mode.
- `git` for worktree and repository-aware workflows.
- `gh` if you want agents to create draft PRs.

## Install

Install the latest release:

```bash
curl -fsSL https://raw.githubusercontent.com/Eldergenix/proofloop/main/install.sh | bash
```

The installer supports macOS and Linux. It installs:

- `loop`
- `claude-loop`
- `codex-loop`

By default, binaries are installed to `~/.local/bin`.

## Run From Source

```bash
bun install

# start paired interactive tmux mode
./loop.ts

# run a task
./loop.ts --proof "Run the relevant tests and checks" "Implement the feature"

# open the dashboard
./loop.ts dashboard
```

Build the executable:

```bash
bun run build
./loop --proof "Run the relevant tests and checks" "Implement the feature"
```

Install local aliases globally:

```bash
bun run install:global
loop --help
```

## Common Workflows

Start paired interactive mode:

```bash
loop
```

Run a task with proof requirements:

```bash
loop --proof "Run bun test and verify the changed behavior" "Fix the bug"
```

Use Claude as the primary worker:

```bash
loop --agent claude --proof "Run the relevant checks" "Implement the change"
```

Run in single-agent Codex mode:

```bash
loop --codex-only --proof "Run the relevant checks" "Implement the change"
```

Run in single-agent Claude mode:

```bash
loop --claude-only --proof "Run the relevant checks" "Implement the change"
```

Skip plan review for a plain-text prompt:

```bash
loop --review-plan none --proof "Run the relevant checks" "Implement the change"
```

Run with both reviewers explicitly:

```bash
loop --review claudex --proof "Run the relevant checks" "Implement the change"
```

Skip the completion quality gate:

```bash
loop --quality-gate none --proof "Run a focused smoke test" "Try the experiment"
```

Run inside tmux:

```bash
loop --tmux --proof "Run the relevant checks" "Implement the change"
```

Run inside a fresh worktree:

```bash
loop --worktree --proof "Run the relevant checks" "Implement the change"
```

Resume a paired run:

```bash
loop --run-id 7 --proof "Continue from the current PLAN.md"
```

Open the dashboard:

```bash
loop dashboard
```

## Paired Mode

Paired mode is the default. `--agent` selects the primary worker:

- `--agent codex`: Codex works, Claude reviews/supports.
- `--agent claude`: Claude works, Codex reviews/supports.

The non-primary agent stays available as a persistent reviewer/support session. Agents coordinate through the bridge instead of asking the human to relay messages.

Each paired run stores a manifest and transcript under:

```text
~/.loop/runs/<repo-id>/<run-id>/
```

Use:

- `--run-id <id>` to resume a specific paired run.
- `--session <id>` to resolve a run from a run id, Claude session id, or Codex thread id.
- `--worktree` to re-enter or recreate the matching worktree for resumed runs.
- `--tmux` to keep the same tmux naming aligned with the run id.

## PLAN.md Flow

If the prompt input is plain text, Proofloop creates `PLAN.md` first. The plan is reviewed by the non-primary model by default, then the approved plan becomes the task input.

If options are provided without a prompt and `PLAN.md` already exists, Proofloop uses the existing plan.

Use `--review-plan none` to skip the automatic plan review.

## Options

- `dashboard`: open the live panel for active sessions, recent paired runs, and tmux sessions.
- `claude-loop`: alias for `loop --claude-only`.
- `codex-loop`: alias for `loop --codex-only`.
- `-a, --agent <claude|codex>`: primary worker agent. Default: `codex`.
- `--claude-only`: use Claude for work, review, and plan review.
- `--codex-only`: use Codex for work, review, and plan review.
- `-p, --prompt <text|.md file>`: prompt text or path to a Markdown prompt file.
- `--proof <text>`: proof requirements for task completion.
- `--codex-model <model>`: model passed to Codex. `LOOP_CODEX_MODEL` can also set this.
- `--codex-reviewer-model <model>`: Codex reviewer model for `--review` and `--review-plan`.
- `--claude-reviewer-model <model>`: Claude reviewer model for `--review` and `--review-plan`.
- `-m, --max-iterations <number>`: maximum loop count. Default: `20`.
- `-d, --done <signal>`: done signal. Default: `<promise>DONE</promise>`.
- `--format <pretty|raw>`: output format. Default: `pretty`.
- `--review [claude|codex|claudex]`: completion review mode. Default: `claudex`.
- `--quality-gate <adversarial|none>`: completion quality gate. Default: `adversarial`.
- `--review-plan [other|claude|codex|none]`: reviewer for automatic `PLAN.md` review. Default: `other`.
- `--run-id <id>`: reuse a specific paired run id.
- `--session <id>`: resume from a paired run id or raw session/thread id.
- `--tmux`: run in a detached tmux session.
- `--worktree`: create and run inside a fresh git worktree and branch.
- `-v, --version`: show version.
- `-h, --help`: show help.

## Development

```bash
# format
bun run fix

# lint/style
bun run check

# strict source typecheck
bun run typecheck

# tests
bun test

# executable build
bun run build
```

CI runs:

```bash
bun run check
bun run typecheck
bun test
bun run build
```

Manual Codex tmux proxy reconnect check:

```bash
bun tests/loop/codex-tmux-proxy.manual.ts --model gpt-5.4-mini
```

## Updating

Prebuilt binaries check for updates automatically on startup and apply updates on the next run.

Manual update:

```bash
loop update
```

Alias:

```bash
loop upgrade
```

Source checkouts should use `git pull`.

## Author

Proofloop is authored by [Eldergenix](https://github.com/Eldergenix).

## License

[MIT](LICENSE.md)
