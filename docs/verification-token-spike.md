# Token Acquisition Spike — Phase 1 Verification

**Date:** 2026-04-27
**OS:** macOS Darwin 24.5.0 (Apple Silicon)

## Approach A — Read server child process environment

**Result: FAILED**

The HTTPToolkit desktop app spawns `httptoolkit-server` via bash wrappers:
```
PID 93594: bash .../httptoolkit-server/bin/httptoolkit-server start
PID 93608: bash .../client/bin/httptoolkit-server start
PID 93613: bash .../client/1.25.1/bin/httptoolkit-server start
```

`ps -E -p <pid>` on macOS does not show environment variables for these processes.
Additionally, the verification spike confirmed that httptoolkit-server deletes `HTK_SERVER_TOKEN` from `process.env` after reading it, so even if we could read the env, the token would be gone.

No separate `node` process found for httptoolkit-server — it runs embedded within the Electron app context.

## Approach B — Run httptoolkit-server standalone

**Result: VIABLE (not yet executed)**

Binary path: `/Users/pradeepsuvarna/.local/share/httptoolkit-server/client/1.25.1/bin/httptoolkit-server`
Bundled Node: `/Users/pradeepsuvarna/.local/share/httptoolkit-server/client/1.25.1/bin/node`

Steps:
1. Quit HTTPToolkit desktop app (to free ports 8000, 45456, 45457)
2. Launch standalone: `HTK_SERVER_TOKEN=verify-token-12345 /Users/pradeepsuvarna/.local/share/httptoolkit-server/client/1.25.1/bin/httptoolkit-server start`
3. Verify with: `curl -H "Authorization: Bearer verify-token-12345" -H "Origin: https://app.httptoolkit.tech" http://127.0.0.1:45457/version`

**Caveats:**
- Loses the desktop UI (can still use curl through the proxy)
- Token rotates if server restarts (but it's our known token)
- Need to confirm standalone server creates the Unix socket at `$TMPDIR/httptoolkit-ctl.sock`

## Recommended verification plan

1. Run Layer 2 (read tools) NOW with desktop app running — socket works, no token needed
2. Stop desktop app, start standalone with known token
3. Generate fresh traffic through the standalone proxy
4. Run Layer 3 (replay tools) with the known token

Token value: `<set via env var at runtime, not committed>`
