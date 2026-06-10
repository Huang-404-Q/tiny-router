## Why

Users want one long-running tiny-router gateway to serve multiple Claude Code terminals without forcing every terminal or project to share the same route configuration. A per-terminal router token lets each Claude Code session explicitly opt into tiny-router while letting the gateway choose the right project-specific config, route state, and future observability data.

## What Changes

- Add multi-client routing support where the gateway can identify a Claude Code session by its local router token.
- Allow a central gateway config to map each client token to a client name and project-specific router config file.
- Keep the existing single-config mode working for simple one-user setups.
- Maintain independent next-route state per client so terminal A and terminal B do not overwrite each other's route choice.
- Make `/health` token-aware so statusline scripts and users can see the route/model for the calling client.
- Update launcher/statusline behavior and documentation to explain opt-in per-terminal usage clearly.

## Capabilities

### New Capabilities

### Modified Capabilities
- `smart-model-routing`: Extend the existing gateway routing contract to support multiple authenticated clients, per-client configuration files, and per-client route state.

## Impact

- Affected code: `src/server.js`, statusline script, launcher scripts, fake-upstream tests, README, and example configuration.
- APIs: `POST /v1/messages` and `GET /health` become token-aware while preserving compatibility with the existing single `routerApiKey` mode.
- Configuration: add optional `clients` mapping for multi-client mode; keep existing `upstreams` config for simple mode.
- Security: router tokens are local gateway credentials only; upstream provider API keys remain inside per-client router config files.
