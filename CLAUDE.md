# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A CLI tool (`harness`) that orchestrates AI agents (Interrogator, Generator, Evaluator) in a control-loop architecture to autonomously complete tasks. Based on control theory — see `docs/SPEC.md` for the authoritative product rules.

## Commands

```bash
npm install                       # Install dependencies
npm link                          # Register `harness` CLI globally
npm start "<task>"                # Run orchestrator directly (dev mode)
npm run reset                     # Clear all task state under .harness/
npx tsx orchestrator.ts "<task>"  # Run without npm scripts

harness "<task>"                  # Sugar: discover + execute
harness discover "<task>"         # Only Phase -1 inquiry (produces pending task)
harness execute [task-id]         # Run autonomous execution on a task
harness execute --direct "<task>" # Skip inquiry (opt-out)
harness                           # Resume in-progress or list pending
harness onboard                   # Interactive configuration wizard
```

## Architecture

Five-phase loop per task: **inquire (once) → negotiate → implement → review → holistic**.

Each task lives in its own isolated directory under `.harness/tasks/<task-id>/`. Sprint state is task-local; session IDs for SDK `resume` are **task-level** (not sprint-level) — all sprints of a task share the same Generator / Evaluator sessions.

### Entry Points

- `orchestrator.ts` — main loop. Dispatches subcommands, drives the sprint loop via phase functions.
- `bin/harness.mjs` — CLI shebang wrapper (also installs stdout/stderr redirection for api mode before any import).

### Source Modules (`src/`)

- `types.ts` — shared interfaces: `Sprint`, `Feature`, `Task`, `ReviewResult`, `HarnessConfig`.
- `paths.ts` — **single source of truth for filesystem layout**. Exports `TOOL_DIR`, `WORK_DIR`, `HARNESS_DIR`, `TASKS_DIR`, `PROMPTS_DIR`, plus `taskDir(id)`, `inquiryDirFor(id)`, `progressDirFor(id)`. Anyone constructing a path to task state must use these helpers.
- `config.ts` — loads config with priority: `.harness/config.json` (project) > `~/.harness/config.json` (global) > `config.default.json` (built-in). Re-exports the `paths.ts` helpers for convenience. Merges squad presets when `HARNESS_SQUAD` is set. Also exports `mcpServersForRole(role)` / `mcpAllowedToolsForRole(role)` — per-role MCP 视图，按 `enabled / roles / allowedTools` 三层门禁过滤后给 `agent.ts` 装载。
- `agent.ts` — `runAgent(role, prompt, opts)` wraps `@anthropic-ai/claude-agent-sdk`'s `query()`. Handles token-limit resume, rate-limit retry, structured-output parsing. `loadPrompt(path, vars)` renders markdown templates with `{{var}}` substitution.
- `sprint.ts` — sprint file CRUD: `sprintPath`, `loadSprint`, `tryLoadSprint`, `currentSprintNumber`, `ensureProgressDir`, `updateSprintState`, `parseEvaluation`. Files live at `.harness/tasks/<id>/progress/sprint-N.json`.
- `inquire.ts` — Phase -1 (live human ↔ Interrogator) + task lifecycle utilities: `inquire`, `createDirectTask`, `createHeadlessTask`, `loadTask`, `saveTask`, `listTasks`, `listPendingTasks`, `pickTaskToExecute`, `taskStatus`, plus `referenceFromInquiryDir` / `inquiryPaths` / `buildInquiryReference` for downstream agents.
- `phases.ts` — the four post-inquiry phases: `negotiate()`, `implement()`, `reviewAll()`, `holisticReview()`. Largest module.
- `event.ts` — `emit(type, payload)` writes structured NDJSON to stdout when `HARNESS_API_MODE=1`; no-op in CLI mode.
- `litellm.ts` — auto-installs, configures, and lifecycle-manages a LiteLLM proxy for custom model backends.
- `onboard.ts` — interactive CLI configuration wizard (`harness onboard`).
- `squad.ts` — loads squad preset JSON (partial `HarnessConfig`) when `HARNESS_SQUAD` env var is set.
- `strip-proxy.ts` — tiny reverse proxy between LiteLLM and Volcano Ark / other backends that don't accept certain OpenAI-style fields.
- `ui.ts` — ANSI helpers, tool-call logging, review formatting.
- `mcp-builtin/` — in-process MCP server 实现，由 `config.ts` 在 `type:'builtin'` 时实例化注入给 SDK。
  - `computer-use.ts` — 桌面操作（screenshot/click/type/key），macOS-only，cliclick 依赖；详见 SPEC §10.7。

### Prompt Templates (`prompts/`)

All agent prompts are external markdown files with `{{variable}}` placeholders, loaded by `loadPrompt()` in `agent.ts`.

- `inquire/interrogator.md` — Phase -1 Socratic interrogator (no summary, no propose)
- `negotiate/generator-system.md` — Generator system prompt for Phase 0
- `negotiate/evaluator-system.md` — Evaluator system prompt for Phase 0
- `implement/generator-system.md` — Generator system prompt for Phase 1 (shared across all features × all sprints of the task)
- `implement/generator-feature.md` — per-feature user message
- `implement/generator-retry.md` — appended when L1 checks fail
- `review/reviewer.md` — N+M parallel reviewer (one per feature / dimension)
- `review/holistic.md` — Phase 3 final holistic audit

### Key Design Decisions

- **Generator has Write/Edit, Evaluator does not** — enforced via SDK `allowedTools` / `disallowedTools` in `agent.ts`, not prompts.
- **`approved` is computed mechanically** — `results.every(r => r.status === 'pass')`, not an LLM judgment. Evaluator emits `{approved}` via SDK StructuredOutput tool; orchestrator reads the boolean.
- **Each sprint gets its own JSON file** — `sprint-1.json`, `sprint-2.json`, etc. Previous sprints are never modified. `previousReview` from sprint N becomes the input to sprint N+1's negotiate.
- **Task-level shared sessions** — `task.negotiateGeneratorSessionId`, `task.negotiateEvaluatorSessionId`, `task.implementSessionId` all live in `task.json`. All sprints resume the same SDK sessions — Generator and Evaluator carry the full cross-sprint history without re-priming.
- **Inter-agent communication is free-text-as-user-message** — Generator's plain-text reply is injected directly as the Evaluator's next user message (and vice versa). No template variable relay.
- **Review uses a worker pool** — `runPool(fns, config.concurrency)` limits parallel reviewer agents.
- **`WORK_DIR` vs `TOOL_DIR`** — agents operate in `process.cwd()` (the user's project); prompts / config default files load from the harness install location. All task state is under `WORK_DIR/.harness/tasks/<id>/`.
- **MCP server 装载（per-server 双重门禁 + capability/policy 解耦）** — `config.mcpServers` 每项支持 `enabled` / `allowedTools`，对所有 server 通用，不为某个 server 单开顶层块。**没有 `roles` 字段**：tool 不分 role 限制，Generator 与 Evaluator 装载同一组 MCP，行为差异走系统提示词（详见 SPEC §10.8）。`type: 'stdio'`（默认）走子进程；`type: 'builtin'` 走 `src/mcp-builtin/<name>.ts` 同进程实现，由 `BUILTIN_FACTORIES` 注册。Interrogator 永不挂 MCP 是硬编码（不是配置）—— 它的 prompt 强约束"只反问"，给 tool 等于打破约束的诱惑。当前默认全部启用：Playwright（stdio，通配）+ computer-use（builtin、macOS-only、cliclick 依赖、精确白名单 `screenshot/left_click/type/key`）。详见 SPEC §八 / §10.7 / §10.8。
- **Prompt paths are injected absolute, never hard-coded** — anything a prompt needs to read (`specPath`, `sessionPath`, `progressFile`, `progressDir`) is passed via template variable from `phases.ts`, always resolved through `paths.ts` helpers. Do not hard-code `.harness/...` inside a prompt.

### Data Flow

```
User task
  → inquire (live: user ↔ Interrogator)   → tasks/<id>/inquiry/session.jsonl
  → negotiate (Generator ↔ Evaluator)     → tasks/<id>/inquiry/spec.md + tasks/<id>/progress/sprint-N.json
  → implement (Generator + L1 checks)     → file changes in project
  → reviewAll (N+M parallel reviewers)    → collectedReview
  → if !approved: next sprint with collectedReview as previousReview
  → if approved: holisticReview
  → if holistic pass: done
  → if holistic fail: next sprint with holistic feedback as previousReview
```
