# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A CLI tool (`harness`) that orchestrates two AI agents (Generator and Evaluator) in an adversarial feedback loop to autonomously complete tasks. Based on control theory principles from Harness Engineering.

## Commands

```bash
npm install              # Install dependencies
npm link                 # Register `harness` CLI globally
npm start "<task>"       # Run orchestrator directly (dev mode)
npm run reset            # Clear all sprint files and project artifacts
npx tsx orchestrator.ts  # Run without npm scripts
```

## Architecture

The system runs a Sprint loop: **negotiate → implement → review → holistic review**.

### Entry Points

- `orchestrator.ts` — Main loop. Reads config, manages sprint lifecycle, delegates to phases.
- `bin/harness.mjs` — CLI entry point (shebang wrapper that loads orchestrator.ts).

### Source Modules (`src/`)

- `types.ts` — All shared interfaces: `Sprint`, `Feature`, `ReviewResult`, `HarnessConfig`, etc.
- `config.ts` — Loads config with priority: `.harness/config.json` (project) > `~/.harness/config.json` (global) > `config.default.json` (built-in). Exports `TOOL_DIR`, `WORK_DIR`, `PROGRESS_DIR`, `PRINCIPLES_FILE`.
- `agent.ts` — `runAgent(role, prompt, opts)` wraps `@anthropic-ai/claude-agent-sdk`'s `query()`. Handles token limit resume, rate limit retry, error recovery. Collects all assistant text blocks for inter-agent communication.
- `sprint.ts` — Sprint file CRUD: `loadSprint`, `tryLoadSprint`, `updateSprintState`, `parseEvaluation`. Sprint files live at `.harness/progress/sprint-N.json`.
- `phases.ts` — The four phases: `negotiate()`, `implement()`, `reviewAll()`, `holisticReview()`. This is the largest module.
- `litellm.ts` — Auto-installs, configures, and lifecycle-manages a LiteLLM proxy for custom model support.
- `onboard.ts` — Interactive CLI configuration wizard (`harness onboard`).
- `ui.ts` — ANSI helpers, tool call logging, review formatting.

### Prompt Templates (`prompts/`)

All agent prompts are external markdown files with `{{variable}}` placeholders, loaded by `loadPrompt()` in `agent.ts`.

- `generator-plan.md` / `generator-plan-revise.md` — negotiate phase
- `evaluator-plan.md` — negotiate phase (Evaluator side)
- `generator.md` / `generator-retry.md` — implement phase
- `reviewer.md` — N+M parallel review (one per feature/dimension)
- `reviewer-holistic.md` — final holistic audit

### Key Design Decisions

- **Generator has Write/Edit, Evaluator does not** — enforced via SDK `disallowedTools`, not prompts.
- **`approved` is computed mechanically** — `results.every(r => r.status === 'pass')`, not an LLM judgment.
- **Each sprint gets its own JSON file** — `sprint-1.json`, `sprint-2.json`, etc. Previous sprints are never modified.
- **Agent text is relayed between sessions** — Generator's full text response (`textBlocks.join`) is injected into Evaluator's prompt as `{{generatorResponse}}`, enabling conversation without shared sessions.
- **Review uses a worker pool** — `runPool(fns, config.concurrency)` limits parallel reviewer agents.
- **`WORK_DIR` vs `TOOL_DIR`** — agents operate in `process.cwd()`, prompts/config load from the package install location.

### Data Flow

```
User task → negotiate (Generator ↔ Evaluator) → sprint-N.json
         → implement (Generator + L1 checks) → file changes
         → reviewAll (N+M parallel reviewers) → collectedReview
         → holisticReview → pass/fail
         → if fail: next sprint with collectedReview as input
```
