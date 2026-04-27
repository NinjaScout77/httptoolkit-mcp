# CLAUDE.md — Working agreement for Claude Code on httptoolkit-mcp

You are working on **httptoolkit-mcp**, a production-grade MCP server that lets LLMs drive HTTPToolkit. Read `PLANNING.md` first if you haven't — it's the architecture and the source of truth for what we're building. This document is about *how* we work together to build it.

## Who's who

- **Pradeep (the user)** owns the repo, reviews every PR, makes product calls when something is genuinely ambiguous.
- **You (Claude Code)** are the implementer. You have local filesystem, Node, npm, git, and the ability to run a real HTTPToolkit instance. Use them.
- **Me (the planning Claude in chat)** wrote `PLANNING.md` and `CLAUDE.md`. I'm not in your session. If something in the plan is wrong or unclear, you can flag it for Pradeep — don't try to reach me.

## Top-level principles

1. **Plan, decide, then code.** When you start a phase, restate the plan back in your own words, list the open questions, and either answer them yourself with a clear rationale or ask Pradeep before proceeding. Don't just dive in.

2. **Small, real commits.** One logical change per commit. Real commit messages — what changed and why, not "WIP" or "updates". Phase 1 should produce 15-30 commits, not 3 mega-commits.

3. **Test as you go, not at the end.** Every module that has logic ships with tests in the same commit. The mutation engine in particular needs heavy tests — that's the most logic-dense piece in the codebase.

4. **Verify with real HTTPToolkit, not assumptions.** Several things in `PLANNING.md` are flagged as "verify on a real install" — token file paths, CORS Origin values, body encoding behavior. Actually verify them. Update `PLANNING.md` when you do.

5. **Production-grade means boring.** Clear errors, sensible defaults, good logs, no surprises. Resist the urge to add cleverness. The codebase should read like utility code, not like a demo.

6. **Stay in scope.** `PLANNING.md` defines exactly 14 tools across 3 phases. Don't add a 15th tool because it seems useful. Don't expand a phase because you have time. Out-of-scope ideas go in a `ROADMAP.md` or as GitHub issues, not into the build.

## Branching and PR workflow

- `main` is protected. Never commit directly.
- Each phase has its own branch: `phase-1-mvp`, `phase-2-hardening`, `phase-3-cookbook`.
- Within a phase, work in feature branches off the phase branch: `phase-1-mvp/mutation-engine`, `phase-1-mvp/auth-detection`, etc.
- When a feature is complete: PR feature branch → phase branch. When the phase is complete: PR phase branch → main.
- PR descriptions must explain what changed, what was tested, and any decisions made. The PR body is part of the project documentation.

## Phase 1 specifics

**Scope:** 7 tools (`events_list`, `events_get`, `events_body`, `replay_request`, `replay_raw`, `server_status`, `interceptors_list`), mutation engine, allowlist, audit log, rate limiter, Burp upstream, README, basic CI.

**Suggested order of work:**

1. Project skeleton — `package.json`, `tsconfig.json`, `.eslintrc`, `.prettierrc`, basic `src/index.ts` that boots the MCP SDK with stdio transport. Verify it shows up in Claude Code's MCP server list with no tools. Commit.

2. **Verification spike (do this early).** Install HTTPToolkit if not present. Run it. Find the auth token file path on this OS. Confirm the API is reachable on `127.0.0.1:45457`. Make a hand-rolled `curl` call to `/api/operations` with the right Origin and Bearer headers and confirm you get back the operations list. **Update `PLANNING.md` with what you found.** Commit the doc update before writing client code.

3. `httptoolkit/auth.ts` — token detection with the verified path. Tests for the detection logic (mock filesystem).

4. `httptoolkit/client.ts` — base REST client with auth headers and CORS. Wrap `undici` with a thin retry layer (3 retries on network errors, no retries on 4xx/5xx — those are real responses).

5. `httptoolkit/bridge.ts` — call `GET /api/operations` to discover available operations, `POST /api/execute` to invoke them. This is the read path. Build it once, use it for all read tools.

6. `tools/server.ts` — `server_status` and `interceptors_list`. These are the smallest tools and shake out the bridge layer. Implement, register with the MCP server, manually verify via the MCP inspector.

7. `tools/read.ts` — `events_list`, `events_get`, `events_body`. Use the bridge. Verify the filter syntax works by capturing some traffic in HTTPToolkit and listing it through the MCP.

8. `core/mutations.ts` — the headline piece. **Write tests first.** Cover all mutation key types. Then implement. Aim for ≥95% line coverage. This module is pure-functional and has no external dependencies — it should be the easiest to test.

9. `core/allowlist.ts`, `core/ratelimit.ts`, `core/audit.ts` — three small modules, one PR each, with tests.

10. `httptoolkit/send.ts` — `/client/send` wrapper with NDJSON streaming. The trickiest async part. Verify streaming works by sending a request that returns chunked transfer encoding and confirming you get incremental events.

11. `tools/replay.ts` — `replay_request` and `replay_raw`. Wire mutations + allowlist + ratelimit + audit + send. End-to-end test: capture a request in HTTPToolkit, replay through the MCP with a header mutation, verify it appears in HTTPToolkit's view tab AND the audit log AND was rate-limited correctly.

12. README — install instructions, MCP client config snippets for Claude Code and Claude Desktop, the tier table, three example flows.

13. CI — lint + test on every push. Don't worry about publish workflow yet (Phase 2).

14. Tag and publish `0.1.0` to npm.

## Phase 2 specifics

WebSocket subscription is the trickiest part. It needs the active session ID from HTTPToolkit. **Do not scrape log files** (the way fdciabdul does). Instead:

- HTTPToolkit's bridge has a `/api/status` endpoint that may expose the session ID. If yes, use it.
- If not, the WebSocket path is `ws://127.0.0.1:45456/session/<id>/subscription`. Find the session ID by reading HTTPToolkit's source — there's a deterministic way the desktop app knows its own session, and we can either query it or, worst case, file an upstream issue requesting a `/api/session-id` endpoint.

Findings store uses `better-sqlite3`. Pin a version with prebuilt binaries for our target Node versions. If the install ever requires `node-gyp`, we picked the wrong version.

Cross-platform auth detection: actually test on Linux + macOS + Windows. If you don't have a Windows machine, run the test in a GitHub Actions Windows runner via a workflow_dispatch trigger and verify there.

## Phase 3 specifics

Cookbook content. No code. Each recipe is:

- A short explanation of the vulnerability class
- The HTTPToolkit traffic pattern that exposes the candidate
- The exact LLM prompt that would invoke this MCP to test for it
- What a successful exploit looks like, what a non-exploit looks like
- A note about ethics: only test systems you have explicit permission to test

**No client names, no real systems.** All examples use placeholder hosts like `api.example.com`, `users.test.local`.

## Decision-making protocol

You will hit decisions during the build. Three categories:

**Category A — decide and commit.** Anything covered by `PLANNING.md` or obvious from context. Pick the boring/standard option, commit, move on. Examples: lint config, test framework specifics, file naming conventions.

**Category B — decide, document, flag in PR.** Anything where there's a real choice but the wrong answer is recoverable. Pick what you think is right, write a paragraph in the PR description explaining the tradeoff and why you went the way you did, ship it. Pradeep can push back at review time. Examples: error message wording, log format details, retry counts.

**Category C — ask Pradeep first.** Anything where the wrong answer means rework or is irreversible. Wait for an answer. Examples: changing the tool surface, changing public-facing behavior, deviating from `PLANNING.md`.

If unsure which category something is in: it's B.

## What "done" looks like for each phase

A phase is done when **all** of these are true:

- Every tool in scope works end-to-end against a real HTTPToolkit
- All commits pass CI
- README is updated to match the current behavior
- `CHANGELOG.md` entry written
- PR from phase branch to main is reviewed and merged
- npm package is published with the right version tag
- A short demo (recorded asciinema or a markdown walkthrough with example outputs) shows a representative end-to-end flow

Don't skip the demo. It's the proof.

## Handling errors and oversights

If you discover something in `PLANNING.md` that's wrong, document it:

1. Stop coding the affected piece
2. Update `PLANNING.md` with what's actually true
3. Note the change in the PR description
4. Ask Pradeep if the change has scope implications

If you realize you've gone down a wrong path mid-phase: stop, write up what you tried and why it doesn't work, ask Pradeep how to proceed. Don't push through bad architecture out of momentum.

## Things to actively avoid

- **Magic.** No "smart" defaults that depend on parsing log files, checking process lists, or sniffing environment for behavior. If the user has to set a config var, that's fine. If we have to scrape something, that's not.

- **Cleverness.** No DSLs, no plugin systems, no "extensible architectures" for things that have one user. Inline the simple solution.

- **Vendoring or patching.** Don't fork HTTPToolkit. Don't patch its files. Don't import from its private modules. Talk to it over its public API only.

- **Silent failure.** Every error path logs. Every fallback says it's a fallback. The LLM and the user both need to know when something didn't work as intended.

- **Optimism.** "It probably works on Windows" is not verification. Either test it or say it's untested.

- **Adding deps.** Anything beyond the list in `PLANNING.md` § Dependencies needs justification in the PR description.

## When you finish a phase

Open a PR phase-branch → main. PR description includes:

- What was built (link to phase section in `PLANNING.md`)
- What was changed in `PLANNING.md` and why
- Any open issues or follow-ups for the next phase
- The demo (asciinema link or markdown walkthrough)

Then wait for Pradeep's review. Do not start the next phase until the current one is merged.

## Style notes

- Code style: Prettier defaults except `printWidth: 100` and `singleQuote: true`. Don't bikeshed.
- Imports: type imports separated, alphabetical within groups.
- Errors: typed error classes, never throw bare strings or generic `Error`s past the module boundary. The LLM-facing surface should always return structured errors.
- Logs: JSON-structured to stderr. The MCP protocol uses stdout, so stderr is the only safe channel for human-readable logs.
- Tests: arrange-act-assert, one behavior per test, descriptive names ("rejects mutations with unknown path prefixes" not "test mutation 3").

## A final note

This project is going on the public security community's radar. It will get used by people who don't know us, on engagements we won't see. The bar for correctness and clarity is "would I want to find this on GitHub when I'm trying to solve this problem?" If yes, ship it. If no, fix it first.

Good luck.

— Planning Claude (and Pradeep, by proxy)
