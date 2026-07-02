# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Run all tests (84 automated tests, node:test + node:assert, no jest/vitest)
node --test scripts/__tests__/*.mjs

# Run a single test file
node --test scripts/__tests__/spawn-subagent.test.mjs

# Syntax check a script
node --check scripts/launch-chrome.mjs

# Generate a sub-agent prompt (4 roles: scout/search/boundary/review)
node scripts/spawn-subagent.mjs --role search --goal "验证 X 的定价" --must-verify "价格"
node scripts/spawn-subagent.mjs --role scout --goal "调研 Y 领域"
node scripts/spawn-subagent.mjs --role boundary --goal "评估覆盖度" --task-dir ~/.sleuth/output/<task>/
node scripts/spawn-subagent.mjs --role review --goal "审计证据链" --task-dir ~/.sleuth/output/<task>/ --draft-path ~/.sleuth/output/<task>/draft.md

# Environment check (first thing sleuth does each run)
node scripts/check-deps.mjs --check-only

# Start Chrome with CDP debugging (symlink profile, preserves login state)
node scripts/launch-chrome.mjs
```

## Architecture

sleuth is a Claude Code skill — a multi-agent research system where a main agent orchestrates 4 types of sub-agents through structured file I/O.

**Agent roles:**
- **Main Agent** — reads SKILL.md, dispatches sub-agents via `spawn-subagent.mjs` + Task tool, maintains state files, synthesizes reports
- **Scout** — breadth-first landscape scan before research begins (WebSearch + WebFetch only)
- **Search** — deep iterative research: WebSearch → WebFetch → reflect → refine query → repeat. Returns JSONL findings
- **Boundary** — reads existing findings, evaluates coverage completeness (read-only, no tools)
- **Review** — audits draft against findings evidence chain (WebFetch for URL verification only)

**Pipeline (SKILL.md phases):**
Phase 0 (check-deps) → 1 (classify complexity) → 1.5 (scout) → 2 (task_spec.md) → 3 (search agents, ≤5 concurrent) → 4 (boundary agent) → 5 (termination check with convergence rules) → 6 (mixed dispatch, back to 3) → 7 (one-shot synthesis) → 8 (audit, critical → back to 3, max 3 times) → 9 (deliver)

**State files** live in `~/.sleuth/output/<task-name>/`: `landscape.json`, `task_spec.md`, `findings.jsonl`, `follow_ups.json`, `directions.json`, `draft.md`, `audit_report.yaml`

**Sub-agent communication:**
- `spawn-subagent.mjs` generates prompt text → stdout
- Main agent copies prompt text into Task/Agent tool
- Search agents return JSONL findings via task tool response
- Main agent normalizes and writes to `findings.jsonl` (§3.3)
- Boundary and Review agents return YAML output

**Tool name portability** (fixed in commit `e62d5b2`): Reference docs use capability descriptions (网络搜索/网页读取/浏览器操控), not Claude Code tool names. Sub-agent prompts from `spawn-subagent.mjs` map capabilities to actual tools.

## What NOT to do

Based on AOP test failures (see `docs/AOP-TEST-POSTMORTEM.md`):

1. **Do not skip phases.** Phase 4 (boundary), Phase 5 (termination), Phase 6 (mixed dispatch), and Phase 8 (audit) are mandatory. Skipping them causes reports with hallucinated content and 0-finding companies.
2. **Do not synthesize before collecting all agent results.** In the AOP test, 6 of 11 search agents returned data that the main agent never collected because it rushed to Phase 7.
3. **Do not write draft chapters for companies without findings.** If a company has 0 findings in `findings.jsonl`, it should not appear in `draft.md`.
4. **Do not make the sub-agent prompt by hand.** Always use `spawn-subagent.mjs` to generate prompts.
5. **Concurrency cap of 5 is real.** Do not dispatch >5 search agents per round.
6. **Do not use `--profile` with `--cdp`** — mutually exclusive in agent-browser.
7. **Do not introduce session/deliver/research-index systems** — already removed.
8. **Do not add npm dependencies** — this project is zero-dependency by design.

## Key constraints

- **Zero npm dependencies** — `scripts/` uses only `node:*` built-in modules
- **ESM only** — `import` with `node:` protocol, no CommonJS, no `require`
- **Node ≥ 18** — uses `node:util/parseArgs`, `node:test`, `fs.mkdirSync({ recursive: true })`
- **Distributed via `npx skills add`** — SKILL.md is the entry point, all paths are relative from SKILL.md root
- **Path resolution**: `spawn-subagent.mjs` uses `import.meta.url` + `path.resolve(.., '..')` to self-locate the skill root. Never hardcode paths or rely on `${CLAUDE_SKILL_DIR}` env var.
- **Sub-agents never read SKILL.md** — their prompts are self-contained with inline safety boundaries and absolute file paths
- **V3 is in design phase.** `docs/DESIGN-v3.md` is the design document. Do not implement v3 features (raw/ sub-agent writes, normalize.mjs, validate-state.mjs, progress.json, PreToolUse hooks) until the design is finalized and given explicit go-ahead. The current production code is v2.
- **Design docs are in `docs/`** (gitignored): `DESIGN-v2.md` (v2 architecture), `DESIGN-v3.md` (v3 proposal), `AOP-TEST-POSTMORTEM.md` (test failure analysis), `TESTING.md` (manual test procedures)
- **AGENTS.md is the project knowledge base** — read it for conventions, anti-patterns, and file location guide.

## Documentation Style

- 中文硬规则用 **必须 / 绝不 / 不要 / 禁止 / 不允许**（不用英文 DO NOT/NEVER）
- 引用纪律：每个核心结论**必须内联 URL** `[结论](https://来源URL)`，单源最多 15 词直引，默认 paraphrase

## Communication Style（回复用户时的语言规范）

用户不是技术背景，英文也不太好。回复时遵循以下规则：

- **用大白话讲清楚**：解释任何东西时，优先用日常类比或一句话白话，不要堆专业黑话。比如不要只说「走 CDP」，要说「通过调试端口让 agent 能指挥 Chrome 浏览器」。
- **英文术语必须括号标中文**：任何英文术语（代码标识符、产品名、缩写除外）第一次出现时，在后面加括号写中文意思。例：「profile（用户配置目录）」「fallback（兜底方案）」「snippet（搜索结果的摘要片段）」。**代码里的变量名/函数名/命令行 flag（如 `check-deps.mjs`、`--task-name`）不用翻译**，那是专有名词。
- **不确定对方懂不懂就主动解释**：宁可多解释一句，也不要默认对方知道。如果某个概念对理解整件事很关键，先花一两句把它讲明白，再往下走。
- **不要嫌烦**：用户问技术问题时，即使问题很简单，也耐心用他能懂的方式回答，不要甩一句「去查文档」或「这很基础」。
