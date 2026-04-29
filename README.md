<p align="center">
  <h1 align="center">httptoolkit-mcp</h1>
  <p align="center">
    <strong>The missing bridge between LLMs and HTTP security testing</strong>
  </p>
  <p align="center">
    <a href="https://github.com/NinjaScout77/httptoolkit-mcp/actions/workflows/ci.yml"><img src="https://github.com/NinjaScout77/httptoolkit-mcp/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
    <a href="https://www.npmjs.com/package/@ninjascout77/httptoolkit-mcp"><img src="https://img.shields.io/npm/v/@ninjascout77/httptoolkit-mcp" alt="npm version"></a>
    <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"></a>
    <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%3E%3D20-brightgreen" alt="Node >= 20"></a>
    <a href="https://modelcontextprotocol.io"><img src="https://img.shields.io/badge/MCP-compatible-blue" alt="MCP Compatible"></a>
  </p>
</p>

---

> **Capture traffic. Ask your LLM to test it. Get results.**
>
> `httptoolkit-mcp` is a production-grade [MCP server](https://modelcontextprotocol.io) that lets any MCP-compatible LLM client — Claude Code, Claude Desktop, Cursor, Codex — drive [HTTPToolkit](https://httptoolkit.com) for **automated API security testing with replay, mutation, and audit**.

---

## Why This Exists

HTTPToolkit's [built-in MCP](https://httptoolkit.com/docs/) gives LLMs **read-only** access to captured traffic. That's useful for debugging, but security testers need more:

| Capability | HTTPToolkit Built-in MCP | **httptoolkit-mcp** |
|:-----------|:------------------------:|:-------------------:|
| List & inspect captured traffic | Yes | **Yes** |
| View request/response bodies | Yes | **Yes** |
| **Replay requests with mutations** | No | **Yes** |
| **Send arbitrary requests** | No | **Yes** |
| **Scope allowlist (host restrictions)** | No | **Yes** |
| **Forensic audit log (JSONL)** | No | **Yes** |
| **Per-host rate limiting** | No | **Yes** |
| **Burp Suite upstream routing** | No | **Yes** |
| **Auto-detect auth token** | N/A | **Yes** |

**This is the tool that turns "capture and inspect" into "capture, mutate, replay, and report."**

---

## What Makes This Different

### For Pentesters & Security Engineers

Most MCP servers give LLMs read access to data. This one gives them **controlled write access** to HTTP traffic — the ability to replay captured requests with surgical mutations, gated by safety primitives that prevent the LLM from going rogue.

```
┌─────────────────────────────────────────────────────────────────┐
│                     YOUR TESTING WORKFLOW                        │
│                                                                 │
│   Mobile App / Browser / API Client                             │
│          │                                                      │
│          ▼                                                      │
│   ┌─────────────────┐    ┌──────────────────┐                  │
│   │  HTTPToolkit     │───▶│  Burp Suite      │───▶ Target API  │
│   │  (capture proxy) │    │  (optional)      │                  │
│   └────────┬────────┘    └──────────────────┘                  │
│            │                                                    │
│            ▼                                                    │
│   ┌─────────────────────────────────────┐                      │
│   │  httptoolkit-mcp                    │                      │
│   │                                     │                      │
│   │  ► Read captured traffic            │                      │
│   │  ► Replay with mutations            │  ◄── LLM Client     │
│   │  ► Scope allowlist enforcement      │      (Claude Code,   │
│   │  ► Rate limiting                    │       Cursor, etc.)  │
│   │  ► Audit logging                    │                      │
│   └─────────────────────────────────────┘                      │
└─────────────────────────────────────────────────────────────────┘
```

### The Mutation Engine

The core differentiator. JSON-pointer-style mutations let the LLM surgically modify any part of a captured request before replaying it:

| Mutation Key | What It Does | Security Use Case |
|:-------------|:-------------|:------------------|
| `headers.Authorization` | Remove/replace auth header | Auth bypass testing |
| `headers.X-Forwarded-For` | Inject IP header | SSRF / IP restriction bypass |
| `url.path.<n>` | Swap a path segment | IDOR (e.g., `/users/1` to `/users/2`) |
| `url.query.<name>` | Modify query param | Parameter tampering |
| `method` | Change HTTP method | Verb tampering (GET to DELETE) |
| `body.<field>` | Patch JSON body field | Privilege escalation (`is_admin: true`) |
| `body.raw` | Replace entire body | Mass assignment testing |
| `url.host` | Change target host | SSRF probing |

**All mutations are validated before firing.** Unknown paths, malformed URLs, and invalid methods are rejected with clear error messages — not silent failures.

### Safety by Default

This MCP runs unattended in LLM workflows. Three safety layers prevent accidents:

> **Scope Allowlist** — `REPLAY_ALLOWLIST="*.example.com,api.test.local"` restricts which hosts the LLM can target. If unset, replays are allowed but every call logs a warning.

> **Rate Limiter** — 10 req/s per host by default. Token bucket with queue depth 100. Prevents the LLM from accidentally DoS'ing a target.

> **Audit Log** — Every replay writes to `~/.httptoolkit-mcp/audit.jsonl`. Cannot be disabled. Auto-rotates at 100MB. Your forensic record of what the LLM actually fired.

---

## Quick Start

### 1. Install

```bash
npm install -g @ninjascout77/httptoolkit-mcp
# or run directly without installing
npx -y @ninjascout77/httptoolkit-mcp
```

> **Requirements:** Node.js >= 20 and [HTTPToolkit desktop app](https://httptoolkit.com) running.

### 2. Configure Your LLM Client

<details>
<summary><strong>Claude Code</strong></summary>

Add to `~/.claude.json` or project `.mcp.json`:

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
</details>

<details>
<summary><strong>Claude Desktop</strong></summary>

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
</details>

<details>
<summary><strong>Cursor / Other MCP Clients</strong></summary>

Any MCP-compatible client works. Configure the server command as:

```
npx -y @ninjascout77/httptoolkit-mcp
```

No additional configuration needed — token auto-detection handles authentication.
</details>

### 3. Start Testing

```
You:  "List the last 10 API requests"
LLM:  → events_list({ limit: 10 })

You:  "Take that POST to /api/users and replay it without the auth header"
LLM:  → replay_request({ event_id: "abc", mutations: { "headers.Authorization": null }, description: "Auth bypass test" })

You:  "Now try accessing user 2's profile with user 1's session"
LLM:  → replay_request({ event_id: "abc", mutations: { "url.path.2": "user-2-id" }, description: "IDOR test" })
```

**That's it.** The MCP auto-detects the auth token from the running HTTPToolkit instance. No manual token extraction needed.

---

## Tools Reference

### Read Tools — No Auth Required

These work immediately when HTTPToolkit is running. Zero configuration.

| Tool | Description |
|:-----|:------------|
| **`events_list`** | List captured HTTP exchanges with filtering and pagination. Filter syntax matches HTTPToolkit's UI search bar. |
| **`events_get`** | Get full event outline — headers, status code, timing, source — without body content. |
| **`events_body`** | Get request or response body. Binary content returned as base64. Supports offset/length for large bodies. |
| **`server_status`** | HTTPToolkit proxy config, connection status, replay availability, and MCP version. |
| **`interceptors_list`** | Available interceptors (browser, terminal, system proxy, etc.) and their activation status. |

**Filter examples for `events_list`:**
```
"method=POST"                              — POST requests only
"status>=400"                              — error responses
"hostname*=api contains(password)"         — API hosts with "password" in body
```

### Replay Tools — Auto-Detected Auth

These require the HTTPToolkit auth token, which is **auto-detected** from the running desktop app on macOS and Linux.

| Tool | Description |
|:-----|:------------|
| **`replay_request`** | Replay a captured event with optional mutations. The core tool for security testing. |
| **`replay_raw`** | Send an arbitrary HTTP request (not based on a capture). For crafted payloads. |

<details>
<summary><strong>replay_request — Full Schema</strong></summary>

```
Input: {
  event_id: string              — ID of the captured event to replay
  mutations?: {                 — Optional mutations to apply
    "headers.<name>": value,    — Set/replace/delete a header
    "url.path": "/new/path",    — Replace URL path
    "url.path.<n>": "segment",  — Replace nth path segment (0-indexed)
    "url.query.<name>": value,  — Set/replace/delete query param
    "url.host": "new.host",     — Change target host
    "method": "DELETE",         — Change HTTP method
    "body.raw": "...",          — Replace entire body
    "body.<field>": value       — Patch JSON body field
  }
  description: string           — Required. For the audit log.
  ignore_https_errors?: boolean — Ignore TLS certificate errors
}

Output: {
  status: number,               — HTTP status code
  headers: object,              — Response headers
  body: string,                 — Response body (truncated at 64KB)
  body_truncated: boolean,
  body_size: number,
  timing: { startTime, endTime, durationMs },
  replay_id: string,            — Unique ID for this replay
  audit_id: string              — Links to audit log entry
}
```
</details>

<details>
<summary><strong>replay_raw — Full Schema</strong></summary>

```
Input: {
  method: string,               — HTTP method
  url: string,                  — Full target URL
  headers?: [string, string][], — Request headers as [name, value] pairs
  body?: string,                — Request body
  body_encoding?: "utf-8"|"base64",
  description: string,          — Required. For the audit log.
  ignore_https_errors?: boolean
}

Output: { same as replay_request }
```
</details>

#### Verifying Replays

> **Important:** Replays do **not** appear in HTTPToolkit's View tab or Send tab. The View tab shows organic intercepted traffic; the Send tab is UI-initiated only. Replays fired via the MCP are returned directly to the LLM and recorded in the audit log at `~/.httptoolkit-mcp/audit.jsonl`. **The audit log is your ground truth** for what the LLM actually fired.

---

## Security Testing Workflows

### BOLA / IDOR Testing

```
1. Capture a request to /api/users/123/profile (user A's session)
2. "Replay this request but swap the user ID to 456"
   → mutations: { "url.path.2": "456" }
3. If you get user 456's data back → finding: BOLA vulnerability
```

### Authorization Bypass

```
1. Capture an authenticated request with Authorization header
2. "Replay without the auth header"
   → mutations: { "headers.Authorization": null }
3. If the request succeeds → finding: missing auth check
```

### Privilege Escalation

```
1. Capture a POST to /api/users (creating a normal user)
2. "Replay with is_admin set to true"
   → mutations: { "body.is_admin": true }
3. If the user is created as admin → finding: mass assignment / privilege escalation
```

### Verb Tampering

```
1. Capture a GET request to /api/admin/users
2. "Replay as DELETE"
   → mutations: { "method": "DELETE" }
3. If data is deleted → finding: missing method restrictions
```

### SSRF Probing

```
1. Capture a request with a URL parameter (e.g., callback_url)
2. "Replay with callback_url pointing to internal service"
   → mutations: { "url.query.callback_url": "http://169.254.169.254/latest/meta-data/" }
3. If metadata is returned → finding: SSRF vulnerability
```

### Burp Suite Integration

Route all replays through Burp for additional passive scanning:

```bash
BURP_UPSTREAM=http://127.0.0.1:8080 httptoolkit-mcp
```

Replayed requests appear in Burp's HTTP history for further manual analysis. The dual-proxy chain is: **MCP → HTTPToolkit → Burp → Target**.

---

## Authentication

### How It Works

HTTPToolkit uses two communication channels:

| Channel | Auth Required | Used For |
|:--------|:--------------|:---------|
| **Unix socket** | No | Read tools (`events_*`, `server_status`, `interceptors_list`) |
| **HTTP API** (port 45457) | Yes (Bearer token) | Replay tools (`replay_request`, `replay_raw`) |

**Read tools work immediately** — zero config, as long as HTTPToolkit is running.

**Replay tools auto-detect the token** from the running HTTPToolkit server process:

```
Resolution Chain:
  1. HTK_SERVER_TOKEN env var     ← explicit override (highest priority)
  2. Auto-detect from OS process  ← sysctl (macOS) / /proc (Linux)
  3. null                         ← clear error with instructions
```

The desktop app generates a random token per session and passes it to the server process. Even though the server deletes the variable from its Node.js heap, **the OS kernel retains the initial process environment**. The MCP reads this via platform-native APIs.

### Platform Support for Auto-Detection

| Platform | Auto-Detection | Mechanism |
|:---------|:--------------:|:----------|
| **macOS Intel** | Yes | `sysctl(KERN_PROCARGS2)` |
| **macOS Apple Silicon** | Yes | `sysctl(KERN_PROCARGS2)` |
| **Linux x86_64** | Yes | `/proc/<pid>/environ` |
| **Linux ARM64** | Manual | Set `HTK_SERVER_TOKEN` |
| **Windows** | Manual | Set `HTK_SERVER_TOKEN` |

### Manual Token Setup (When Auto-Detection Isn't Available)

Run the server standalone with a known token:

```bash
HTK_SERVER_TOKEN=my-known-token httptoolkit-server start
```

Then pass the same token to the MCP via your LLM client's config:

```json
{
  "mcpServers": {
    "httptoolkit": {
      "command": "npx",
      "args": ["-y", "@ninjascout77/httptoolkit-mcp"],
      "env": {
        "HTK_SERVER_TOKEN": "my-known-token"
      }
    }
  }
}
```

### Token Security Model

> The `HTK_SERVER_TOKEN` is a **local-only authenticator**, not a cryptographic secret. It prevents other local processes from accidentally controlling your HTTPToolkit instance. The real security boundary is your OS user account — any same-user process can read the token via the same mechanism the MCP uses. This is by design: HTTPToolkit is a local development tool, and its threat model assumes a trusted local user.

---

## Configuration

| Variable | Default | Description |
|:---------|:--------|:------------|
| `HTK_SERVER_TOKEN` | Auto-detected | Auth token for replay tools (read tools work without it) |
| `HTK_SERVER_HOST` | `127.0.0.1` | HTTPToolkit server host |
| `HTK_API_PORT` | `45457` | HTTPToolkit REST API port |
| `BURP_UPSTREAM` | — | Upstream proxy URL (e.g., `http://127.0.0.1:8080`) |
| `REPLAY_ALLOWLIST` | Permissive + warning | Comma-separated host patterns: `*.example.com,api.test.local` |
| `REPLAY_RATE_LIMIT_RPS` | `10` | Max replays per second per target host |
| `REPLAY_RATE_LIMIT_QUEUE` | `100` | Max queued replays before rejection |
| `AUDIT_LOG_PATH` | `~/.httptoolkit-mcp/audit.jsonl` | Audit log location |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` |

---

## Tier Requirements

| Tool | Free Tier | Pro Tier |
|:-----|:---------:|:--------:|
| `events_list` | Yes | Yes |
| `events_get` | Yes | Yes |
| `events_body` | Yes | Yes |
| `server_status` | Yes | Yes |
| `interceptors_list` | Yes | Yes |
| `replay_request` | Yes* | Yes |
| `replay_raw` | Yes* | Yes |

> *Basic replay works on Free tier. Some advanced `/client/send` features may require Pro.

---

## Working with LLM Clients

### LLM Memory and Tool Results

LLM clients maintain conversation memory. When you call an MCP tool, the LLM has two context sources: the **actual tool result** and **whatever it remembers from prior conversations**. Default behavior is to combine them — which can mean stating memory-derived claims with tool-anchored authority.

**For security work where data segregation matters:**

> **Pattern 1 — Tool output only:**
> *"Call the `events_list` tool from the httptoolkit MCP. Show me only the fields the tool returned. Do not interpret, do not connect to other context."*

> **Pattern 2 — Demand provenance:**
> *"For each statement, label whether it came from a tool result `[from MCP]` or from your inference `[inference]`."*

### LLMs May Hallucinate Setup Steps

When asked how to configure tools, LLMs may **invent plausible-sounding file paths and config steps that don't exist**. A real example: an LLM suggested reading the token from `~/Library/Preferences/httptoolkit/auth-token` — that file has never existed. HTTPToolkit holds the token only in process memory.

**Defend against this:**
- `ls` any file path before trusting it
- `which` any command before running it
- Ask: *"Can you point me to where this is documented?"*
- **Prefer this README** over LLM-generated setup instructions

### Recommendations for Security Engagements

- Run testing in a **fresh LLM session** with memory disabled for data segregation
- Be explicit: *"from the httptoolkit MCP connector"* to avoid tool ambiguity
- Treat LLM responses as **analyst notes, not findings** — verify against raw tool output
- Set `REPLAY_ALLOWLIST` to lock scope before giving the LLM replay access

---

## Troubleshooting

<details>
<summary><strong>"Cannot connect to HTTPToolkit via socket" on macOS</strong></summary>

**Cause:** Some LLM clients (verified: **Claude Desktop**) strip `$TMPDIR` from child process environments. This causes incorrect socket path computation.

**Not affected:** Claude Code (CLI) — propagates `$TMPDIR` correctly.

**Fix:** Upgrade to `@ninjascout77/httptoolkit-mcp@>=0.2.0` which resolves the path via `getconf DARWIN_USER_TEMP_DIR`. For older versions, inject `TMPDIR` manually:

```json
{
  "env": { "TMPDIR": "/var/folders/.../T/" }
}
```

Get your value with: `getconf DARWIN_USER_TEMP_DIR`
</details>

<details>
<summary><strong>MCP not appearing in Claude Desktop's connectors list</strong></summary>

1. Validate JSON syntax: `cat ~/Library/Application\ Support/Claude/claude_desktop_config.json | python3 -m json.tool`
2. Confirm node path: `which node`
3. Confirm dist exists: `ls /path/to/httptoolkit-mcp/dist/index.js`
4. Check logs: `tail -50 ~/Library/Logs/Claude/mcp-server-httptoolkit.log`
</details>

<details>
<summary><strong>"replayAvailable: false" even though HTTPToolkit is running</strong></summary>

**Cause:** Token auto-detection failed. Possible reasons:
- Windows or Linux ARM64 (auto-detection not yet supported)
- HTTPToolkit server restarted between detection attempts
- OS restricts reading other processes' environment

**Fix:** Set `HTK_SERVER_TOKEN` manually. Run `httptoolkit-server start --token my-token` and use the same token in your MCP config.
</details>

---

## Known Limitations

- **Token auto-detection** requires macOS (x64/ARM64) or Linux x64. Windows and Linux ARM64 require manual `HTK_SERVER_TOKEN`.
- **No persistent capture history** beyond what HTTPToolkit holds. Restarting HTTPToolkit clears the event store.
- **Replay visibility** — replays do not appear in HTTPToolkit's View tab or Send tab. The audit log is your ground truth.
- **Tested against** HTTPToolkit 1.19.4 / httptoolkit-server 1.25.1. Other versions should work but are untested.

---

## Credits

Built by [Pradeep Suvarna](https://github.com/NinjaScout77) (NinjaScout77).

**Thanks to:**
- [Tim Perry](https://github.com/pimterry) for [HTTPToolkit](https://httptoolkit.com) — the platform this builds on
- [fdciabdul](https://github.com/fdciabdul/httptoolkit-mcp) for prior art that informed early design decisions

---

## License

**MIT** — see [LICENSE](./LICENSE).

> **Only test systems you have explicit permission to test.** This tool facilitates security testing; using it against systems without authorization is illegal and unethical. Always obtain written authorization before testing third-party systems. Use responsibly.
