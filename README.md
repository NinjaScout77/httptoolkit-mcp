# @ninjascout77/httptoolkit-mcp

> Drive HTTPToolkit from any MCP-compatible LLM client

[![CI](https://github.com/NinjaScout77/httptoolkit-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/NinjaScout77/httptoolkit-mcp/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@ninjascout77/httptoolkit-mcp)](https://www.npmjs.com/package/@ninjascout77/httptoolkit-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Status:** MVP (Phase 1) — 7 tools for capture analysis and replay with mutations.

## Why this exists

[HTTPToolkit](https://httptoolkit.com) is a powerful HTTP debugging proxy. Its [built-in MCP](https://httptoolkit.com/docs/) exposes read-only tools for inspecting captured traffic. This MCP server extends that with:

- **Replay with mutations** — re-send captured requests with modified headers, paths, query params, or bodies
- **Scope allowlist** — control which hosts the LLM is allowed to replay against
- **Audit log** — every replay is recorded to a JSONL file for forensics
- **Rate limiting** — per-host token bucket prevents accidental DoS
- **Burp upstream** — route replays through Burp Suite for additional analysis

Primary use case: **API and mobile security testing** — capture traffic, ask your LLM to run BOLA/IDOR/auth-bypass tests automatically.

## Install

```bash
npm install -g @ninjascout77/httptoolkit-mcp
# or run directly
npx -y @ninjascout77/httptoolkit-mcp
```

Requires Node.js >= 20 and [HTTPToolkit desktop app](https://httptoolkit.com) running.

## Quick start

### Claude Code

Add to your MCP config (`~/.claude.json` or project `.mcp.json`):

```json
{
  "mcpServers": {
    "httptoolkit": {
      "command": "npx",
      "args": ["-y", "@ninjascout77/httptoolkit-mcp"],
    }
  }
}
```

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "httptoolkit": {
      "command": "npx",
      "args": ["-y", "@ninjascout77/httptoolkit-mcp"]
    }
  }
}
```

No `HTK_SERVER_TOKEN` needed in most cases — the MCP auto-detects it from the running HTTPToolkit desktop app.

## Authentication

HTTPToolkit uses two communication channels:

1. **Unix socket** (automatic, no config needed) — used for read tools
2. **HTTP API** (requires auth token) — used for replay tools

**Read tools work immediately** with no configuration as long as HTTPToolkit is running.

### Replay tools — auto-detection

The replay tools (`replay_request`, `replay_raw`) call HTTPToolkit's HTTP API on port 45457, which requires a Bearer token. The MCP auto-detects this token from the running HTTPToolkit desktop app:

1. **`HTK_SERVER_TOKEN` env var** — explicit override, always takes priority
2. **Auto-detection** — reads the token from the HTTPToolkit server process's OS-level environment via `sysctl` (macOS) or `/proc` (Linux). The desktop app generates a random token per session and passes it to the server process. Even though the server deletes the variable from its Node.js heap, the OS kernel retains the initial process environment.
3. If neither works, replay tools return a clear error explaining what to do.

**This means replay typically "just works"** — start HTTPToolkit desktop, start the MCP, done.

### When auto-detection doesn't work

- **Windows** — not yet supported. Set `HTK_SERVER_TOKEN` manually.
- **Linux ARM64** — prebuilt binary not yet shipped. Set `HTK_SERVER_TOKEN` manually.
- **Restricted environments** — if your OS blocks reading other processes' environment (rare), set `HTK_SERVER_TOKEN` manually.

To set the token manually, run the server standalone: `HTK_SERVER_TOKEN=my-token httptoolkit-server start`, then pass the same token to the MCP config.

### A note on the token's security model

The `HTK_SERVER_TOKEN` is a **local-only authenticator**, not a cryptographic secret. It prevents other local processes from accidentally controlling your HTTPToolkit instance. The real security boundary is your OS user account — any same-user process can read the token via the same mechanism the MCP uses. This is by design: HTTPToolkit is a local development tool, and its threat model assumes a trusted local user.

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `HTK_SERVER_TOKEN` | — | Auth token for replay tools (read tools work without it) |
| `HTK_SERVER_HOST` | `127.0.0.1` | HTTPToolkit server host |
| `HTK_API_PORT` | `45457` | HTTPToolkit REST API port |
| `BURP_UPSTREAM` | — | Upstream proxy URL (e.g., `http://127.0.0.1:8080`) |
| `REPLAY_ALLOWLIST` | — (permissive) | Comma-separated host patterns for replay scope |
| `REPLAY_RATE_LIMIT_RPS` | `10` | Per-host replay rate limit |
| `REPLAY_RATE_LIMIT_QUEUE` | `100` | Max queued replays per host before rejection |
| `AUDIT_LOG_PATH` | `~/.httptoolkit-mcp/audit.jsonl` | Audit log location |
| `LOG_LEVEL` | `info` | Log verbosity: `debug`, `info`, `warn`, `error` |

## Tools

### Read tools (no auth required)

#### `events_list`

List captured HTTP exchanges with filtering and pagination.

```
Input: { filter?: string, limit?: number, offset?: number }
Output: { total: number, events: EventSummary[] }
```

Filter syntax matches HTTPToolkit's UI search bar. Examples:
- `"method=POST"` — POST requests only
- `"status>=400"` — error responses
- `"hostname*=api contains(password)"` — API hosts with "password" anywhere

#### `events_get`

Get full event outline (headers, status, timing) without body content.

```
Input: { id: string }
Output: { id, method, url, request, response, timing, ... }
```

#### `events_body`

Get request or response body. Binary content returned as base64.

```
Input: { id: string, side: "request" | "response", offset?: number, max_length?: number }
Output: { body: string, encoding: "utf-8" | "base64", totalSize: number, isTruncated: boolean }
```

### Server tools (no auth required)

#### `server_status`

Get HTTPToolkit proxy config, connection status, and MCP version.

#### `interceptors_list`

List available interceptors (browser, terminal, system proxy, etc.) and their status.

### Replay tools (requires `HTK_SERVER_TOKEN`)

#### `replay_request`

Replay a captured event with optional mutations.

```
Input: {
  event_id: string,
  mutations?: { "headers.Authorization": "", "url.path": "/admin", ... },
  description: string,
  ignore_https_errors?: boolean
}
Output: { status, headers, body, timing, replay_id, audit_id }
```

**Mutation keys:**
- `headers.<name>` — set/replace/delete (null) a header (case-insensitive)
- `url.path` — replace path (query preserved)
- `url.path.<n>` — replace nth path segment (0-indexed)
- `url.query.<name>` — set/replace/delete a query param
- `url.host` — replace hostname
- `method` — change HTTP method
- `body.raw` — replace entire body
- `body.<field>` — patch JSON body field (JSON content-type only)

#### `replay_raw`

Send an arbitrary HTTP request (not based on a capture).

```
Input: {
  method: string,
  url: string,
  headers?: [string, string][],
  body?: string,
  body_encoding?: "utf-8" | "base64",
  description: string
}
Output: { status, headers, body, timing, replay_id, audit_id }
```

## Tier requirements

Based on initial testing — please open an issue if you find corrections.

| Tool | Free | Pro |
|------|------|-----|
| `events_list` | ✅ | ✅ |
| `events_get` | ✅ | ✅ |
| `events_body` | ✅ | ✅ |
| `server_status` | ✅ | ✅ |
| `interceptors_list` | ✅ | ✅ |
| `replay_request` | ✅* | ✅ |
| `replay_raw` | ✅* | ✅ |

*Replay uses `/client/send` which may require Pro for some features. Basic replay works on Free tier.

## Example flows

### 1. Capture + Analyze

```
User: "List the last 10 API requests to my server"
LLM calls: events_list({ filter: "hostname*=api", limit: 10 })

User: "Show me the details of that 403 response"
LLM calls: events_get({ id: "abc123" })

User: "What's in the request body?"
LLM calls: events_body({ id: "abc123", side: "request" })
```

### 2. Capture + Replay with Mutation

```
User: "Take that authenticated request and replay it without the auth header"
LLM calls: replay_request({
  event_id: "abc123",
  mutations: { "headers.Authorization": null },
  description: "Testing auth bypass - removing Authorization header"
})
```

### 3. IDOR Test

```
User: "Try accessing user 2's data with user 1's token"
LLM calls: replay_request({
  event_id: "abc123",
  mutations: { "url.path.2": "user-2-id" },
  description: "IDOR test - swapping user ID in path"
})
```

## Burp Suite upstream

Route replays through Burp for additional analysis:

```bash
# Start Burp listening on 8080, then:
BURP_UPSTREAM=http://127.0.0.1:8080 httptoolkit-mcp
```

Replayed requests will appear in both HTTPToolkit and Burp's history.

## Safety

### Scope allowlist

Set `REPLAY_ALLOWLIST` to restrict which hosts the LLM can replay against:

```bash
REPLAY_ALLOWLIST="*.example.com,api.test.local,127.0.0.1"
```

**If unset:** replays are allowed to any host, with a warning logged per call. **Always set this in production.**

### Audit log

Every replay is logged to `~/.httptoolkit-mcp/audit.jsonl`:

```json
{"timestamp":"2026-04-27T22:00:00Z","replay_id":"...","source_event_id":"...","mutations":{"headers.Authorization":null},"target_url":"https://api.example.com/users/1","response_status":200,"response_size":1234,"finding_id":null,"description":"Auth bypass test"}
```

Auto-rotates at 100MB. Cannot be disabled.

### Rate limiting

Default 10 requests/second per target host. Configurable via `REPLAY_RATE_LIMIT_RPS`.

## Working with LLM clients

The MCP returns structured tool results to whatever LLM client you've connected. Some practical notes about LLM behavior that affect how you should use these tools, especially for security work.

### LLM memory and tool results

LLM clients like Claude Desktop maintain persistent conversation memory across sessions. When you call an MCP tool, the LLM has two relevant context sources: the actual tool result, and whatever it remembers from prior conversations. Default LLM behavior is to combine them into a "helpful" response — which can mean stating memory-derived claims with the same authority as tool-anchored facts.

Concrete example: ask `server_status` and the LLM may add commentary like *"and your previous engagement chain was X"* — where the engagement detail came from memory, not from the tool. The response looks coherent but mixes verified facts with remembered context.

This matters for security testing where you need clean separation between *what the data shows* and *what the LLM remembers*. Two patterns help.

#### Pattern 1 — Constrain to tool output only

For factual MCP queries where you want only what the tool returned:

> Call the `<tool_name>` tool from the httptoolkit MCP connector. Show me only the fields the tool actually returned. Do not interpret, do not connect to other context, do not infer.

This phrasing reliably produces clean tool-anchored responses. Use it for any query where you're verifying behavior or pulling raw data.

#### Pattern 2 — Demand provenance

For analytical queries where you want the LLM's reasoning but need to separate it from raw data:

> Use the MCP tools as needed. For each statement in your response, indicate whether it came from a tool result (label `[from MCP]`) or from your memory or inference (label `[from memory]` or `[inference]`).

This forces the LLM to internally separate sources before writing. You can review and weigh each claim.

### Recommendations

- For client engagements where data segregation matters, run security testing in a dedicated LLM session with memory disabled, or in a fresh conversation.
- Be explicit about which MCP connector to use when calling tools (e.g., `from the httptoolkit MCP connector`) — this avoids ambiguity if you have multiple MCPs configured.
- Treat LLM responses as analyst notes, not findings. Cross-reference any actionable claim against the underlying tool output before acting on it.

This isn't specific to our MCP. It's good practice for any LLM-driven security workflow.

## Known limitations

- **Token auto-detection requires macOS (x64/ARM64) or Linux x64.** Windows and Linux ARM64 are not yet supported — set `HTK_SERVER_TOKEN` manually on those platforms.
- **No persistent capture history beyond what HTTPToolkit holds.** All read operations query HTTPToolkit's own event store; restarting HTTPToolkit clears it.

## Troubleshooting

### "Cannot connect to HTTPToolkit via socket at /tmp/httptoolkit-XXX/..." on macOS

**Symptom:** The MCP tools fail with errors like `Cannot connect to HTTPToolkit via socket at /tmp/httptoolkit-501/httptoolkit-ctl.sock` even though HTTPToolkit's desktop app is running.

**Cause:** Some LLM clients (notably Claude Desktop, possibly others) launch MCP child processes with sanitized environments that don't propagate `$TMPDIR`. On macOS this causes the MCP to compute the wrong socket path.

**Fix:** Upgrade to `@ninjascout77/httptoolkit-mcp@>=0.1.1` if available. If you must use an earlier version, inject `TMPDIR` via your LLM client's MCP config:

```json
{
  "mcpServers": {
    "httptoolkit": {
      "command": "/opt/homebrew/bin/node",
      "args": ["/path/to/httptoolkit-mcp/dist/index.js"],
      "env": {
        "TMPDIR": "/var/folders/.../T/"
      }
    }
  }
}
```

Get your actual `TMPDIR` value with `getconf DARWIN_USER_TEMP_DIR`.

### MCP not appearing in Claude Desktop's connectors list

**Cause:** Usually a JSON syntax error in `claude_desktop_config.json` or a wrong path to `node`/`dist/index.js`.

**Fix:**
1. Validate the config is valid JSON: `cat ~/Library/Application\ Support/Claude/claude_desktop_config.json | python3 -m json.tool`
2. Confirm the absolute path to your node binary: `which node`
3. Confirm `dist/index.js` exists in your repo: `ls /path/to/httptoolkit-mcp/dist/index.js`
4. Check the MCP launch log: `tail -50 ~/Library/Logs/Claude/mcp-server-httptoolkit.log`

### "replayAvailable: false" even though HTTPToolkit is running

**Cause:** Token auto-detection failed. This can happen if:
- You're on Windows or Linux ARM64 (auto-detection not yet supported)
- The HTTPToolkit server process exited or restarted between detection attempts
- Your OS restricts reading other processes' environment

**Fix:** Set `HTK_SERVER_TOKEN` manually in your MCP config. To get the token, run `httptoolkit-server start --token my-known-token` instead of using the desktop app, then use the same token in your MCP config.

## Credits

Built by [Pradeep Suvarna](https://github.com/NinjaScout77) (NinjaScout77).

Thanks to:
- [Tim Perry](https://github.com/pimterry) for [HTTPToolkit](https://httptoolkit.com)
- [fdciabdul](https://github.com/fdciabdul/httptoolkit-mcp) for prior art

## License

MIT — see [LICENSE](./LICENSE).

⚠️ **Only test systems you have explicit permission to test.** This tool facilitates security testing; using it against systems without authorization is illegal and unethical.
