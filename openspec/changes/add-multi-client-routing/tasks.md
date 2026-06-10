## 1. Configuration Model

- [x] 1.1 Add optional `clients` mapping support to gateway configuration.
- [x] 1.2 Resolve incoming `x-api-key` values to client names and client config paths in multi-client mode.
- [x] 1.3 Preserve existing single-config mode when `clients` is absent.
- [x] 1.4 Load project-specific route configs from client config paths without exposing upstream secrets in errors.

## 2. Per-Client Routing State

- [x] 2.1 Refactor route state loading/saving to operate on a routing context instead of global variables.
- [x] 2.2 Store independent next-route state per client.
- [x] 2.3 Use client-specific config defaults when no valid client state exists.
- [x] 2.4 Ensure valid directives update only the calling client's route state.

## 3. Request and Health Handling

- [x] 3.1 Route `POST /v1/messages` through the resolved client context.
- [x] 3.2 Reject unknown router tokens in multi-client mode with a clear authentication error.
- [x] 3.3 Make `GET /health` return gateway-level health without client details when unauthenticated.
- [x] 3.4 Make `GET /health` return client name, next route, next model, reason, and timestamp for valid client tokens.

## 4. Statusline and Launch UX

- [x] 4.1 Update the statusline helper to call `/health` with the current terminal's `ANTHROPIC_API_KEY`.
- [x] 4.2 Display client name, route, and upstream model when tiny-router is configured for the current terminal.
- [x] 4.3 Display a concise not-routed state when Claude Code is not using tiny-router.
- [x] 4.4 Update launcher or documentation examples to show per-terminal opt-in with a local router token.

## 5. Tests and Documentation

- [x] 5.1 Add fake-upstream coverage for two clients using different config files through one gateway.
- [x] 5.2 Add coverage that client route state changes do not affect another client.
- [x] 5.3 Add coverage for unknown router tokens in multi-client mode.
- [x] 5.4 Add coverage for token-aware `/health` responses.
- [x] 5.5 Update README and example config to explain router tokens, upstream API keys, and per-terminal opt-in.
- [x] 5.6 Run syntax checks and the integration test suite.
