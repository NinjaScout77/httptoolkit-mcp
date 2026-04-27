# Changelog

## 0.1.0 — Phase 1 MVP

### Added

- **7 MCP tools** for HTTPToolkit integration:
  - `events_list` — list captured HTTP exchanges with filtering and pagination
  - `events_get` — get full event outline (headers, status, timing)
  - `events_body` — get request/response body with binary detection
  - `server_status` — proxy config, connection status, version
  - `interceptors_list` — available interceptors and their status
  - `replay_request` — replay captured events with mutations
  - `replay_raw` — send arbitrary HTTP requests

- **Mutation engine** — JSON-pointer-style mutations for headers, URL path/query/host, method, and body (JSON or raw)

- **Safety primitives:**
  - Scope allowlist via `REPLAY_ALLOWLIST` env var
  - JSONL audit log (auto-rotating at 100MB)
  - Per-host token bucket rate limiter

- **Dual-transport architecture:**
  - Unix socket for read tools (zero config)
  - HTTP API for replay tools (requires `HTK_SERVER_TOKEN`)

- **Burp Suite upstream** support via `BURP_UPSTREAM`

- CI pipeline (lint + test + build) on GitHub Actions
