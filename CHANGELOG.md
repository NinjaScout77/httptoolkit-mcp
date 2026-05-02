# Changelog

## 0.2.2 — Intel Mac support

### Fixed
- **Missing `darwin-x64` prebuilt binary** in published 0.2.0 and 0.2.1 packages — Intel Mac users got silent auto-detection failure with no `HTK_SERVER_TOKEN`. Resolved by cross-compiling from `macos-15` runners with `-arch x86_64` after GitHub deprecated `macos-13` runners.

### Changed
- **CI workflow** switched from `macos-13` (dead) to `macos-15` with cross-compile flags for darwin-x64 builds. darwin-arm64 also moved to `macos-15` for consistency.
- **Platform warning** — logs a one-time warning when no native binary exists for the current platform, instead of silently returning null.
- **npm metadata** — improved package description and added keywords for discoverability.

### Notes
- 0.2.0 and 0.2.1 worked correctly on Apple Silicon Macs (`darwin-arm64`) and Linux x86_64. Only Intel Macs were affected.

## 0.2.0 — Auto-detection and Reliability

### Added

- **Automatic discovery of `HTK_SERVER_TOKEN`** from the running HTTPToolkit desktop app via platform-native APIs (`sysctl(KERN_PROCARGS2)` on macOS, `/proc/<pid>/environ` on Linux). Replay tools now work zero-config when HTTPToolkit is running on supported platforms.
- **Prebuilt native binaries** shipped for `darwin-arm64`, `darwin-x64`, `linux-x64`. CI builds via GitHub Actions on tag push.
- **Distinct `HTTPTOOLKIT_NOT_RUNNING` error** when replay tools are called but no HTTPToolkit server process is detected — separate from the `AUTH_TOKEN_MISSING` error when the server is running but the token can't be read.
- **Auth token caching** with 401-based invalidation — handles HTTPToolkit restarts transparently. Token is read once on first replay call, cached for MCP process lifetime, and re-detected once on auth failure.
- **"Working with LLM clients" README section** covering memory bleed, hallucinated setup paths, and defensive prompt patterns for security work.

### Fixed

- **macOS socket path resolution** when `$TMPDIR` is not propagated by GUI launchers. Resolved via `getconf DARWIN_USER_TEMP_DIR`. Affected Claude Desktop users on macOS; Claude Code (CLI) was not affected because it inherits `$TMPDIR` from the parent shell.
- **`bridge.ts` operation failures** now throw typed `OperationFailedError` and detect Pro-tier rejections as `ProRequiredError` instead of bare `Error` strings.
- **`AuthTokenMissingError`** now returns structured payload with `tools_affected` / `tools_still_available` for cleaner LLM error handling.
- **`/client/send` wire format** — auto-inject `Host` and `Content-Length` headers that HTTPToolkit's http-client omits due to `setDefaultHeaders: false`.

### Documentation

- Comprehensive troubleshooting section with verified client-specific behavior (Claude Desktop vs Claude Code)
- Authentication section rewritten to document auto-detection, manual fallback, and the token's local-only security model
- Hallucinated-paths warning documenting a real incident where an LLM invented a non-existent auth-token file path

### Platform support

- **macOS (Intel and Apple Silicon):** full support including token auto-detection
- **Linux x86_64:** full support including token auto-detection
- **Linux ARM64:** read tools work; replay tools require manual `HTK_SERVER_TOKEN` (no prebuilt binary yet)
- **Windows:** read tools work via named pipe; replay tools require manual `HTK_SERVER_TOKEN`

### Known limitations

- Token auto-detection requires HTTPToolkit desktop app version compatible with current `sysctl`/`proc` behavior. Tested against HTTPToolkit 1.19.4 and httptoolkit-server 1.25.1.
- On multi-user systems, `pgrep -f` may match another user's HTTPToolkit server process. Documented as a known limitation; not a risk on single-user developer machines.

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
