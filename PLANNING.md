# httptoolkit-mcp — Planning Document

**Status:** Approved for Phase 1 build
**Author:** Pradeep Suvarna (NinjaScout77)
**GitHub:** https://github.com/NinjaScout77/httptoolkit-mcp
**npm:** `@ninjascout77/httptoolkit-mcp` (scoped — see Distribution below)
**Last updated:** 2026-04-27

---

## Distribution and naming

The GitHub repo name is `httptoolkit-mcp`. The unscoped npm package name `httptoolkit-mcp` is already taken on the npm registry by an unrelated project (`fdciabdul/httptoolkit-mcp`, ~30 days old at this writing). We therefore publish to npm as the **scoped** package `@ninjascout77/httptoolkit-mcp`.

End-user install:

```
npm install -g @ninjascout77/httptoolkit-mcp
# or
npx -y @ninjascout77/httptoolkit-mcp
```

The CLI binary is still called `httptoolkit-mcp` (defined via `package.json` `bin`), so once installed the user runs `httptoolkit-mcp` directly. The scope only appears at install/publish time.

`package.json` requires `"publishConfig": { "access": "public" }` for a scoped package to publish publicly without a paid npm org account.

---

## What this is

A production-grade MCP (Model Context Protocol) server that lets any MCP-compatible LLM client — Claude Code, Claude Desktop, Cursor, Codex, etc. — drive HTTPToolkit. It exposes captured HTTP traffic as queryable data, lets the LLM replay and mutate requests through HTTPToolkit's proxy chain, and provides safety primitives (scope allowlist, audit log, rate limiting) needed for unattended operation.

**Primary use cases the design optimizes for, in priority order:**

1. **API and mobile security testing** — pentester captures traffic from a mobile app, asks the LLM to run BOLA/IDOR/SSRF/auth-bypass test patterns automatically. This is the deepest workflow we support and where we differentiate.
2. **API exploration and debugging** — developer captures traffic from their own app, asks the LLM "what's failing?" and gets structured analysis without copy-pasting requests.
3. **Automated regression checks** — CI-style flows where the LLM replays known-good traffic with mutations and checks for regressions.

**Non-goals:**

- We are not building a Burp Suite replacement. Burp stays in the chain as the upstream proxy when the user wants it; we don't replicate its scanner, repeater, or intruder.
- We are not building a fuzzer. Mutation primitives are deterministic patches, not random fuzz inputs. (A separate fuzz pack could ship later as a companion module.)
- We are not building HTTPToolkit features that HTTPToolkit doesn't already have. If `/client/send` doesn't support something, neither do we.

## What HTTPToolkit gives us, and what it doesn't

HTTPToolkit is open source. It has two relevant APIs running locally when the desktop app is open:

- **Mockttp standalone server** on port `45456` — the proxy itself, with WebSocket event subscriptions for live traffic
- **REST + GraphQL admin server** on port `45457` — config queries, the operations bridge that HTTPToolkit's own bundled MCP uses, and the `/client/send` endpoint that powers the Send tab

The official HTTPToolkit MCP (shipped inside the desktop app, invoked via the `httptoolkit-mcp` wrapper) exposes 7 read-only tools: `events_list`, `events_get-outline`, `events_get-request-body`, `events_get-response-body`, `events_clear`, `interceptors_list`, `interceptors_activate`, `proxy_get-config`. **No send/replay tool.**

The REST endpoint `POST /client/send` exists and works (it's what the UI's Send tab calls) but is not wired into the MCP bridge.

This MCP fills the gap between what HTTPToolkit's bundled MCP does and what a security engineer actually needs: replay with mutations, scope guards, audit trails, findings tracking.

## Architecture

```
┌──────────────────┐      ┌────────────────────────┐      ┌──────────────────────┐
│  Mobile/desktop  │ HTTP │     HTTPToolkit        │ HTTP │     Burp (opt)       │
│  client          │─────▶│     desktop app        │─────▶│     127.0.0.1:8080   │─────▶ target
│                  │      │                        │      │                      │
│                  │      │  Mockttp :8000/45456   │      │                      │
│                  │      │  REST/GQL :45457       │      │                      │
└──────────────────┘      └───────────┬────────────┘      └──────────────────────┘
                                      │
                              ┌───────┴────────┐
                              │ /api/operations│  (HTTPToolkit's official MCP bridge)
                              │ /client/send   │
                              │ /session/<id>/ │  (WebSocket for live events)
                              │   subscription │
                              └───────┬────────┘
                                      │
                          ┌───────────┴────────────┐
                          │  httptoolkit-mcp   │
                          │  (this project, stdio) │
                          │                        │
                          │  - Read tools          │
                          │  - Replay tools        │
                          │  - Capture tools       │
                          │  - Findings tools      │
                          │  - Server tools        │
                          └───────────┬────────────┘
                                      │ stdio JSON-RPC
                                      │
                              ┌───────┴────────┐
                              │  Any MCP-      │
                              │  compatible    │
                              │  LLM client    │
                              └────────────────┘
```

**Read tools** delegate to HTTPToolkit's official `/api/operations` bridge via Unix domain socket. We do not duplicate event storage — HTTPToolkit owns it, we query it. No auth needed.

**Replay tools** call `POST /client/send` on the HTTP API (port 45457, auth required) with mutated request bodies. Request `rawBody` is base64-encoded. Response body parts in the NDJSON stream are also base64-encoded. Optionally configured to route through Burp upstream.

**Capture tools** subscribe to the existing UI session's WebSocket on port 45456 and stream events into our in-memory ring buffer. (Note: this part is the trickiest and Phase 2 work — Phase 1 ships without it.)

**Findings tools** are local — they write to a SQLite store in `~/.httptoolkit-mcp/findings.db`. No HTTPToolkit dependency.

**Server tools** are thin wrappers over HTTPToolkit's existing config endpoints.

## Tool surface — exactly 14 tools

| # | Tool | Phase | Tier required | Notes |
|---|------|-------|---------------|-------|
| 1 | `events_list` | 1 | Free | Filter, paginate, summary fields |
| 2 | `events_get` | 1 | Free | Full event minus bodies |
| 3 | `events_body` | 1 | Free | Request or response body, with offset/length |
| 4 | `replay_request` | 1 | Pro* | Replay captured event with mutations |
| 5 | `replay_raw` | 1 | Pro* | Send arbitrary request from scratch |
| 6 | `replay_batch` | 2 | Pro* | Replay one event N times with different mutations |
| 7 | `capture_subscribe` | 2 | Free | Start streaming live events |
| 8 | `capture_since` | 2 | Free | Pull events since checkpoint |
| 9 | `capture_unsubscribe` | 2 | Free | Stop streaming |
| 10 | `findings_mark` | 2 | Free | Tag an event as a finding |
| 11 | `findings_list` | 2 | Free | List findings |
| 12 | `findings_export` | 2 | Free | Markdown / JSON report |
| 13 | `server_status` | 1 | Free | Proxy port, cert, upstream config, tier |
| 14 | `interceptors_list` | 1 | Free | Available interceptors |

*Pro tier is enforced by HTTPToolkit's API, not by us. We surface their tier-required errors cleanly.

**No `interceptor_activate_X` per-target tools.** The list-the-interceptor + activate-by-id pattern works fine; we don't need a dozen wrappers.

### Tool schemas (Phase 1)

Detailed Zod schemas in `src/tools/*.ts`. Summary:

**`events_list`**
- Input: `{ filter?: string, limit?: number (default 20, max 100), offset?: number }`
- Filter syntax matches HTTPToolkit's UI search bar — pass through verbatim. See https://httptoolkit.com/docs/reference/view-page/#filtering-intercepted-traffic
- Output: `{ total: number, events: EventSummary[] }` where `EventSummary = { id, method, url, status?, timestamp, hostname, path }`

**`events_get`**
- Input: `{ id: string }`
- Output: `{ id, method, url, requestHeaders, requestTrailers, requestBodySize, statusCode, statusMessage, responseHeaders, responseTrailers, responseBodySize, timing, source }`

**`events_body`**
- Input: `{ id: string, side: "request" | "response", offset?: number, max_length?: number }`
- Output: `{ body: string, totalSize: number, isTruncated: boolean }`
- Body returned as utf-8 text. Binary content returned as base64 with `encoding: "base64"` field.

**`replay_request`**
- Input: `{ event_id: string, mutations?: Record<string, any>, description: string, ignore_https_errors?: boolean | string[] }`
- `description` is required and free-text — for the audit log.
- `mutations` keys are JSON-pointer-style paths against the request object. Examples:
  - `"headers.Authorization": ""` — empty Bearer
  - `"headers.X-Forwarded-For": "127.0.0.1"` — header injection
  - `"url.path": "/users/00000000-0000-0000-0000-000000000001"` — path swap
  - `"body.is_admin": true` — body field flip (works for JSON bodies)
  - `"body.raw": "<custom raw bytes>"` — full body override
  - `"method": "POST"` — method change
- Output: `{ status, headers, body (truncated if large + path to full), timing, replay_id, audit_id }`

**`replay_raw`**
- Input: `{ method, url, headers?: [string, string][], body?: string, body_encoding?: "utf-8" | "base64", description: string, ignore_https_errors?: boolean | string[] }`
- Output: same as `replay_request`

**`server_status`**
- Input: `{}`
- Output: `{ httpProxyPort, certPath, certFingerprint, externalNetworkAddresses, tier: "free" | "pro" | "unknown", upstreamProxy: { url, reachable } | null, version }`

**`interceptors_list`**
- Input: `{}`
- Output: `Interceptor[]` — verbatim from HTTPToolkit

## Mutation engine

The most subtle bit of Phase 1. Lives in `src/core/mutations.ts`. Pure function, fully unit-testable.

**Input:** A captured request (JSON object with `method`, `url`, `headers`, `rawBody`) and a mutations dict.

**Mutation key syntax:** Dot-separated paths. Special prefixes:

- `headers.<name>` — set, replace, or delete (if value is null/undefined) a header. Case-insensitive name match.
- `url.path` — replace the path portion of the URL. Query string preserved.
- `url.path.<n>` — replace the nth path segment (0-indexed, after the leading slash). Useful for ID swaps.
- `url.query.<name>` — set/replace/delete a query parameter.
- `url.host` — replace the hostname (not recommended — usually the wrong scope).
- `method` — replace the HTTP method.
- `body.raw` — replace the entire body with a literal string or base64-encoded bytes.
- `body.<json_path>` — patch a JSON body using a JSON-pointer-like path. Only works if Content-Type is `application/json` or `application/x-www-form-urlencoded`. Otherwise errors with a clear message suggesting `body.raw`.

**Validation rules:**

- Mutation paths are validated up front. Unknown path prefixes (`foo.bar`) error before any request fires.
- Multiple mutations can be applied in a single call; they're applied in dict-iteration order. Order is not guaranteed across JS runtimes, so we sort keys deterministically (alphabetical) before applying.
- A mutation that would produce an invalid request (e.g., a method that's not in the HTTP spec, a malformed URL after path mutation) errors before firing.

**Tests:** Every mutation type has at least three tests — happy path, edge case, and one rejection case. The mutation engine has near-100% line coverage in Phase 1; everything else can be lighter.

## Safety primitives

These are non-negotiable. The MCP is going to be aimed at real systems by an LLM, often unattended for stretches of time. We do not want a Sorcerer's Apprentice incident.

### Scope allowlist

- Env var: `REPLAY_ALLOWLIST`, comma-separated host patterns supporting `*` wildcards.
- Examples: `*.example.com,api.test.local,127.0.0.1`
- Default if unset: **permissive but logged** — every replay logs a warning to stderr `[allowlist] no allowlist configured, allowing replay to <host>`. This nudges users toward setting it without blocking out-of-the-box use.
- Recommended setting documented in README, with a security warning.
- Replays to non-matching hosts return a structured error: `{ error: "OutOfScope", message: "..." }`. The LLM gets this and can ask the user.
- The allowlist is checked **after** mutations are applied (so a mutation that changes `url.host` is also gated).

### Rate limiting

- Default: 10 requests per second per target host. Configurable via `REPLAY_RATE_LIMIT_RPS` env var.
- Implemented as a token bucket per target host, in-memory.
- When the bucket is empty, replays are queued (not rejected) up to a queue depth of 100. Queue overflow returns `{ error: "RateLimited", retry_after_ms: ... }`.
- `replay_batch` participates in the same bucket — no way to bypass via batch.

### Audit log

- Every replay writes one JSONL line to `~/.httptoolkit-mcp/audit.jsonl`.
- Schema: `{ timestamp, replay_id, source_event_id, mutations, target_url, response_status, response_size, finding_id, description }`
- Append-only. Auto-rotates at 100MB to `audit.jsonl.<timestamp>` and starts a new file.
- The path is overridable via `AUDIT_LOG_PATH` env var.
- This is unconditional — no flag to disable. Forensics > convenience.

### Tier-required handling

- Any HTTPToolkit API call that returns a Pro-required error gets caught and wrapped as `{ error: "ProRequired", operation: "...", upgrade_url: "https://httptoolkit.com/get-pro" }`.
- The LLM relays this to the user clearly, instead of crashing or showing a stack trace.
- We do not gate or check tier ourselves. HTTPToolkit owns the policy.

## Cross-platform concerns

### Two communication channels (VERIFIED 2026-04-27)

HTTPToolkit exposes two local interfaces. Our MCP uses both:

1. **Unix domain socket** — no auth required, used by the built-in MCP:
   - macOS: `$TMPDIR/httptoolkit-ctl.sock`
   - Linux: `$XDG_RUNTIME_DIR/httptoolkit-ctl.sock` or `/tmp/httptoolkit-<uid>/httptoolkit-ctl.sock`
   - Windows: `\\.\pipe\httptoolkit-ctl`
   - Serves: `/api/status`, `/api/operations`, `/api/execute`
   - Sufficient for all read tools (events, interceptors, proxy config)

2. **HTTP REST API** on port 45457 — requires Bearer auth + CORS Origin:
   - Serves: everything above PLUS `/client/send`, `/interceptors/:id/activate`, `/version`, etc.
   - `/client/send` is **only** available here, not on the socket
   - Required for replay tools

**Architecture decision:** Use Unix socket for all read operations (zero config), HTTP with auth for replay operations. This means read tools work out of the box, replay requires `HTK_SERVER_TOKEN`.

### Auth token detection (`src/httptoolkit/auth.ts`)

**VERIFIED:** There is NO file-based auth token. The desktop app generates an ephemeral token at each startup and passes it to the server via `HTK_SERVER_TOKEN` env var. The server deletes the env var after reading it.

Resolution order for HTTP auth (replay tools only):

1. `HTK_SERVER_TOKEN` env var — user must extract this from the running desktop app
2. If not found, return `null`. Read tools still work via socket. Replay tools return a clear error: "HTK_SERVER_TOKEN required for replay. Read tools work without it."

**How users get the token:** The token is generated per session by the Electron app. Users can:
- Extract it from browser DevTools in the HTTPToolkit UI
- Start the server manually with `--token <value>` for a known token
- We may provide a helper script or document the extraction process

### CORS Origin header

Only needed for HTTP API (port 45457), not for Unix socket.

HTTPToolkit's API requires an Origin from an allowlist (VERIFIED from source):

- **Prod builds** (`IS_PROD_BUILD=true`): Only `https://app.httptoolkit.tech`
- **Dev builds**: Also `http://localhost`, `http://127.0.0.x`, `http://local.httptoolkit.tech`

We set `Origin: https://app.httptoolkit.tech` for prod builds (most users).

### Burp upstream

- Env var: `BURP_UPSTREAM`, e.g. `http://127.0.0.1:8080`. Optional. If unset, replays go direct from HTTPToolkit's HttpClient (which still passes through HTTPToolkit's own proxy logic).
- On startup, if set, do a TCP probe to the host:port. Log the result: "✓ Burp upstream reachable at 127.0.0.1:8080" or "⚠ Burp upstream unreachable at 127.0.0.1:8080 — replays will fail until Burp is running".
- When firing replays, pass the upstream config in the `options.proxyConfig` field of the `/client/send` request body.

## Phasing

### Phase 1 — MVP, ships as 0.1.0

Tools: `events_list`, `events_get`, `events_body`, `replay_request`, `replay_raw`, `server_status`, `interceptors_list`. (7 tools.)

Includes:
- Project skeleton, MCP SDK wiring, stdio transport
- HTTPToolkit client with auth, CORS, error handling
- Mutation engine with full unit tests
- Allowlist + audit log + rate limiter
- Burp upstream wiring with TCP probe
- README with install instructions, tier table, examples
- License (MIT), basic CI (lint + test on push)

Definition of done:
- All 7 tools work end-to-end against a running HTTPToolkit
- Mutation engine has ≥95% line coverage
- README is complete enough that a new pentester can install and run a basic flow without help
- Published to npm as `0.1.0`

### Phase 2 — Production hardening, ships as 1.0.0

Tools added: `replay_batch`, `capture_subscribe`, `capture_since`, `capture_unsubscribe`, `findings_mark`, `findings_list`, `findings_export`. (7 more, total 14.)

Includes:
- WebSocket subscription to HTTPToolkit's session — uses the official `/session/<id>/subscription` endpoint, NOT log-file scraping. Session ID obtained via the bridge's status endpoint.
- SQLite findings store (`better-sqlite3` — synchronous, no native build issues if we pin to a version with prebuilt binaries)
- Markdown findings export with a clean Jira-style template
- Cross-platform auth token detection verified on macOS, Linux, Windows
- Comprehensive error handling — typed error classes, friendly LLM-facing messages
- Integration test suite running against a real HTTPToolkit in Docker
- CI: GitHub Actions for lint, test, build, and npm publish on tag
- `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md` (Contributor Covenant)
- Issue templates: bug report, feature request

Definition of done:
- All 14 tools work end-to-end
- Integration tests pass on GitHub Actions
- README labels each tool's tier requirement based on real testing, not guessing
- Published to npm as `1.0.0` with a GitHub release

### Phase 3 — Security testing pack, ships as 1.1.0

Optional companion content. Doesn't add tools to the MCP itself.

- `examples/security-cookbook.md` — recipes for common test patterns:
  - BOLA / IDOR enumeration on `/users/{id}` style endpoints
  - Authorization header stripping
  - Privilege escalation via JSON body fields (`is_admin`, `role`, etc.)
  - SSRF probes on URL-fetching parameters
  - Path traversal on file operation endpoints
  - Mass assignment
  - Verb tampering
- Each recipe is one or two paragraphs of prose plus an example LLM prompt.
- All examples use generic endpoints. No client names, no real systems.

## Repo structure

```
httptoolkit-mcp/
├── README.md
├── PLANNING.md          (this file)
├── CLAUDE.md            (working agreement for Claude Code)
├── CHANGELOG.md
├── CONTRIBUTING.md      (Phase 2)
├── SECURITY.md          (Phase 2)
├── CODE_OF_CONDUCT.md   (Phase 2)
├── LICENSE              (MIT)
├── package.json
├── tsconfig.json
├── .eslintrc.json
├── .prettierrc
├── .github/
│   ├── workflows/
│   │   ├── ci.yml       (lint + test, Phase 1)
│   │   └── publish.yml  (npm publish on tag, Phase 2)
│   └── ISSUE_TEMPLATE/  (Phase 2)
├── src/
│   ├── index.ts                    Entry point, server bootstrap, stdio
│   ├── server.ts                   MCP server setup, tool registration
│   ├── tools/
│   │   ├── read.ts                 events_list, events_get, events_body
│   │   ├── replay.ts               replay_request, replay_raw, replay_batch (P2)
│   │   ├── capture.ts              capture_subscribe/since/unsubscribe (P2)
│   │   ├── findings.ts             findings_mark/list/export (P2)
│   │   └── server.ts               server_status, interceptors_list
│   ├── httptoolkit/
│   │   ├── client.ts               REST client base
│   │   ├── auth.ts                 Cross-platform token detection
│   │   ├── bridge.ts               /api/operations + /api/execute
│   │   ├── send.ts                 /client/send with NDJSON streaming
│   │   └── ws.ts                   WebSocket subscription (P2)
│   ├── core/
│   │   ├── mutations.ts            Mutation engine
│   │   ├── allowlist.ts            Scope guard
│   │   ├── ratelimit.ts            Token bucket rate limiter
│   │   ├── audit.ts                JSONL audit log
│   │   ├── store.ts                In-memory event ring buffer (P2)
│   │   ├── findings.ts             SQLite findings (P2)
│   │   └── errors.ts               Typed error classes
│   ├── types.ts                    Shared types
│   └── util/
│       ├── logger.ts               stderr logger
│       └── paths.ts                XDG/AppData path resolution
├── test/
│   ├── unit/
│   │   ├── mutations.test.ts       Mutation engine — heaviest tests
│   │   ├── allowlist.test.ts
│   │   ├── ratelimit.test.ts
│   │   └── auth.test.ts
│   ├── integration/                (P2 — runs against real HTTPToolkit)
│   └── fixtures/
└── examples/
    ├── claude-code.json            MCP config snippet
    ├── claude-desktop.json
    └── security-cookbook.md        (P3)
```

## Configuration env vars (full list)

| Name | Default | Purpose |
|------|---------|---------|
| `HTK_SERVER_TOKEN` | auto-detected from token file | HTTPToolkit auth token |
| `HTK_SERVER_HOST` | `127.0.0.1` | HTTPToolkit host |
| `HTK_API_PORT` | `45457` | HTTPToolkit REST/GQL port |
| `HTK_PROXY_PORT` | `45456` | HTTPToolkit Mockttp port |
| `BURP_UPSTREAM` | unset | Upstream proxy URL e.g. `http://127.0.0.1:8080` |
| `REPLAY_ALLOWLIST` | unset (permissive + warn) | Comma-separated host patterns |
| `REPLAY_RATE_LIMIT_RPS` | `10` | Per-host request rate limit |
| `AUDIT_LOG_PATH` | `~/.httptoolkit-mcp/audit.jsonl` | Audit log location |
| `FINDINGS_DB_PATH` | `~/.httptoolkit-mcp/findings.db` | Findings DB location (P2) |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` |

## Dependencies (target list)

Keep small. Every dep is a maintenance liability.

**Runtime:**
- `@modelcontextprotocol/sdk` — MCP server framework
- `zod` — input validation
- `undici` — HTTP client (faster than node-fetch, native to Node 18+)
- `ws` — WebSocket client (Phase 2)
- `better-sqlite3` — findings store (Phase 2)

**Dev:**
- `typescript`
- `tsx` — TS runner for dev
- `vitest` — test runner (faster than jest, better DX)
- `eslint` + `@typescript-eslint`
- `prettier`

That's it. No lodash, no axios, no winston, no commander. Anything else needs justification.

## Open questions for the build

These are flagged for Claude Code to decide during Phase 1 with rationale captured in commits or follow-up updates to this doc:

1. **Token file path verification.** macOS path is documented as `~/Library/Application Support/httptoolkit/auth-token` but I haven't verified it on a real install. First task in Phase 1: run HTTPToolkit, find the actual path, update this doc and the auth code.

2. **CORS Origin allowlist exact patterns.** The HTTPToolkit server has an `ALLOWED_ORIGINS` regex. The two known-good values are `https://app.httptoolkit.tech` and `http://localhost`. Verify by reading `httptoolkit-server/src/constants.ts` (the upstream repo) and use whichever matches the user's build.

3. **Body encoding for `events_body`.** HTTPToolkit returns bodies as text by default. For binary content (images, protobufs), we need to detect and switch to base64. The pragmatic rule: if the body has any byte outside printable ASCII range, return as base64. Confirm against real captures.

4. **Tier detection in `server_status`.** HTTPToolkit's bridge has `accountStore.user.isPaidUser()` internally. Whether this is exposed via any operation is unclear from the source I read. If exposed, use it. If not, return `tier: "unknown"` and rely on per-call tier-required errors.

## Why this design and not alternatives

**Why not fork fdciabdul/httptoolkit-mcp?**
- 60% feature overlap, 0% architectural overlap. Their session detection scrapes log files; we use the official bridge. Their `send_http_request` requires the LLM to construct requests from scratch; we have a mutation engine that operates on captures. Forking would carry forward decisions that don't fit a security-testing tool.

**Why not contribute send/replay upstream to HTTPToolkit?**
- We should, eventually. Phase 2 includes filing an issue/PR upstream proposing a `events.send` or `replay.fire` operation in the official MCP. But that's slow (depends on their review and release cycle), and shipping our MCP doesn't block on it.

**Why TypeScript and not Python?**
- HTTPToolkit's whole stack is TS/Node. Type definitions are reusable. The TS MCP SDK is the most mature. We get strong types on the request/response shapes without re-deriving them from observation.

**Why ring buffer + SQLite instead of one or the other?**
- Ring buffer for live events because they're high-volume and ephemeral. SQLite for findings because they're low-volume and need to survive across sessions to support multi-day audits. Different access patterns; different stores.

**Why MIT and not AGPL like HTTPToolkit?**
- This MCP doesn't include or modify HTTPToolkit code — it talks to HTTPToolkit over its API. AGPL would be unnecessarily restrictive for downstream users (e.g., a security firm can't use it on a paid engagement if AGPL forbids combining with their proprietary internal tooling). MIT lets the security community use it freely while still being clearly open source.

## Success metrics

For Phase 1 ship:
- Installable via `npx -y @ninjascout77/httptoolkit-mcp` zero-config
- Three commands in a fresh shell take a user from zero to a working replay: install HTTPToolkit, run `npx -y @ninjascout77/httptoolkit-mcp`, configure their LLM client
- README walkthrough: capture a request, ask the LLM to swap a header and replay — works first try

For Phase 2 ship:
- Five-star "it just works" experience for the core security loop (capture → analyze → replay with mutations → mark finding → export report)
- Zero crashes from edge cases — malformed mutations, missing auth, target down, Burp not running, etc. — all handled with friendly errors
- Featured on the MCP server registry (https://github.com/modelcontextprotocol/servers community list)

For Phase 3 ship:
- Security cookbook is good enough that someone new to API security testing can use it as a learning resource
- At least one external blog post or talk references the project (organic)

## Credits

Built by Pradeep Suvarna (NinjaScout77).

References and inspiration:
- HTTPToolkit by Tim Perry (@pimterry) — the platform this builds on
- fdciabdul/httptoolkit-mcp — prior art that informed which tools matter
- PortSwigger's mcp-server — reference architecture for security-tool MCPs
