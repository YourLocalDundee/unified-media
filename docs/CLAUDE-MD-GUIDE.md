# CLAUDE.md & Token-Efficiency Guide

How to keep this project cheap to run with Claude Code. This is the reference behind the trimmed
`CLAUDE.md`. Read it once; apply it whenever you edit `CLAUDE.md`, add a doc, or start a session.

Sources: Anthropic's official Claude Code best-practices page
(`code.claude.com/docs/en/best-practices`), Anthropic's memory/CLAUDE.md docs (`/en/memory`), plus
community token-reduction writeups (Firecrawl token-efficiency benchmark, Finout 2026 pricing guide,
buildtolaunch token-optimization guide). Verify specifics against the official docs before relying on
a command name — Claude Code commands evolve.

## The one fact that drives everything

`CLAUDE.md` loads at the **start of every session and injects into every request**. A 5,000-token
`CLAUDE.md` is a 5,000-token tax on every turn, every session — a constant baseline you carry before
you've typed a word. Performance also degrades as context fills ("context rot"): past a point, the
model isn't broken, the context is. So the goal isn't zero context — it's making sure everything in
`CLAUDE.md` is **load-bearing**.

Anthropic's litmus test for every line: **"Would removing this cause Claude to make mistakes?"** If
not, cut it. Bloated `CLAUDE.md` files cause Claude to *ignore* your real instructions because they're
lost in noise.

## What belongs in CLAUDE.md vs not

| ✅ Include | ❌ Exclude (→ move to `docs/` or delete) |
| --------- | --------------------------------------- |
| Bash/deploy commands Claude can't guess (the compose rebuild, the Caddy reload) | Anything Claude can infer by reading the code |
| Code-style rules that differ from defaults (react-hooks at error, no eslint-disable) | Standard language conventions Claude already knows |
| Testing/verify instructions + the preferred runner (`tsc --noEmit`, `eslint`, `npm run build`) | Detailed API docs — link to `sources/` or `docs/` instead |
| Repo etiquette (SemVer patch-before-minor, changelog discipline) | Info that changes frequently |
| Architecture decisions specific to this project (host-net Jellyfin, UMT, party on :3002) | Long explanations/tutorials |
| Env-var quirks (TRUSTED_PROXY_COUNT, the `/api/qbit` vs `/api/qbt` trap) | File-by-file descriptions of the codebase |
| Non-obvious gotchas (cookie-mutation-in-SC-context, MKV seek-before-loadedmetadata) | Self-evident practices ("write clean code") |

The rule of thumb from the community benchmarks: **if a senior dev could figure it out in ~20 minutes
of reading the code, cut it.** One documented case stripped a 3,847-token CLAUDE.md to 312 tokens with
no quality regression.

## Targets for this repo

- **Keep `CLAUDE.md` lean.** Anthropic's own example files are short; community guidance lands around
  "under 200 lines, some teams run at 60." This repo's trimmed `CLAUDE.md` is ~485 lines because §7
  (gotchas) is genuinely load-bearing — that's a deliberate, defensible exception, not licence to
  regrow the rest. When §7 items get fixed in code (e.g. a lint rule now enforces the pattern), delete
  the prose.
- **Deep-dives live in `docs/`, loaded on demand**, not at session start. The pointer-stub pattern
  (a 2–4 line section that links to `docs/features/x.md`) is the whole point of the reorg.
- **One pointer, not two copies.** When a feature ships, move its detail to `docs/complete/` or
  `docs/features/`, leave a stub in `CLAUDE.md`, and delete it from `docs/incomplete/`. Never leave the
  same content in two places — that doubles the maintenance and the eventual token cost when it's read.

## Mechanics that save tokens here

- **HTML comments are free.** `<!-- note -->` is stripped before injection and costs zero tokens. Use
  it for teammate notes / rationale Claude doesn't need to act on.
- **`@path` imports load at session start too.** `See @docs/x.md` pulls the file in *every* session —
  same tax as inline. Use plain prose pointers ("see `docs/x.md`") for on-demand reading; reserve
  `@import` for the rare file Claude should always have. This repo uses **plain pointers** deliberately.
- **Add a `.claudeignore`.** Keep `analysis/` raw audit dumps, `sources/` upstream copies, build
  output, and `node_modules` out of automatic context. Claude can still read them when told to; they
  just don't get pulled in opportunistically.
- **Skills over CLAUDE.md for sometimes-relevant knowledge.** Anything only relevant to *one* kind of
  task (e.g. "how to add a new indexer adapter") belongs in `.claude/skills/<name>/SKILL.md`, loaded on
  demand, not in the always-on `CLAUDE.md`. Keep skill bodies small and link to a longer reference
  file the skill can read when triggered.
- **CLI tools beat API fetches for context.** Install `gh`; Claude uses it for issues/PRs far more
  cheaply than raw API calls, and avoids unauthenticated rate limits.

## Session habits (the bigger lever than the file)

The file is the constant baseline; *session sprawl* is what actually blows budgets.

- **Plan in chat / plan mode before spinning up execution.** The cheap thinking pass saves the
  expensive execution pass. Explore → plan → implement → commit (Anthropic's four-phase workflow). For
  a small, one-sentence-diff change, skip the plan — planning has overhead too.
- **`/clear` between unrelated tasks.** The "kitchen sink session" (task A → unrelated question → back
  to A) fills context with irrelevant material. After **two** failed corrections on the same issue,
  `/clear` and rewrite the prompt with what you learned — a clean session with a better prompt beats a
  long polluted one almost every time.
- **Use subagents for investigation.** "Use subagents to investigate X" explores in a *separate*
  context and reports a summary, keeping the main conversation clean. This is the single biggest
  context lever Anthropic calls out. But **cap parallelism** — runaway subagent fan-out is the
  documented cause of the worst surprise bills (a 23-subagent run reportedly burned $47k over 3 days).
  State a parallelism cap in the prompt and never leave subagent chains running unattended.
- **Give Claude a check it can run.** Tests, a build exit code, a lint pass, a screenshot diff. With a
  check, the loop closes on its own and you can walk away; without one, "looks done" is the only signal
  and you become the verification loop. This repo's check is `npx tsc --noEmit` + `npx eslint <files>`
  + `npm run build`.
- **Watch `/context` and `/cost`.** `/context` shows a live breakdown of what's in the window;
  `/cost` (rebuilt in recent versions) shows per-model spend, cache-hit rate, and rate-limit use. Check
  `/cost` the moment a session feels expensive.
- **Disable non-essential background calls if cost matters.** Auto-memory forks the whole context after
  every message into a parallel call that always cache-misses. `/memory` → turn auto-memory off, or set
  `DISABLE_NON_ESSENTIAL_MODEL_CALLS=1`, to stop background model calls not essential to the task.
- **Pin the Claude Code version in CI/onboarding.** Documented March-2026 incidents (prompt-cache
  bugs, a bad release inflating rate-limit consumption 3–50×) mean a silent team-wide upgrade can spike
  costs overnight. Pin, and check release notes first if a bill suddenly looks wrong.

## Compaction note for this project

Add a compaction instruction to `CLAUDE.md` if long sessions keep losing the same thing. Anthropic
supports lines like: *"When compacting, always preserve the full list of modified files, the current
version number, and the deploy command (`docker compose build --no-cache unified-frontend && docker
compose up -d --force-recreate`)."* That survives summarization so a long build session doesn't forget
how to ship.

## Maintenance loop

Treat `CLAUDE.md` like code:
1. Review it when something goes wrong (Claude did the wrong thing, or asked a question the file
   already answers → the phrasing is ambiguous or the file is too long).
2. Prune regularly. When a gotcha is fixed in code or enforced by a lint rule/hook, delete the prose.
3. Test changes by watching whether Claude's behavior actually shifts — not by assuming the words
   helped.
4. Prefer a **hook** over a prose rule for anything that must happen every time with zero exceptions
   (hooks are deterministic; CLAUDE.md is advisory). E.g. a Stop hook that runs the typecheck/lint gate.
