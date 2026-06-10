## Why

Claude Code work often alternates between expensive reasoning-heavy steps and cheaper execution-heavy steps, but a single fixed upstream model makes every turn pay the same cost. This change defines a small Anthropic-compatible gateway that lets the assistant choose the next route category at the end of each response, so high-capability models can drive planning, strategy, and review while cheaper models handle narrow implementation or routine work.

## What Changes

- Add a route-based gateway contract for forwarding `/v1/messages` requests to configured upstream providers.
- Allow each route to map to a private upstream base URL, API key, and model name while exposing only local route categories to the assistant.
- Inject routing guidance into requests so the assistant can emit a final JSON directive choosing the next route.
- Persist the validated next route between turns and expose the current route through a health endpoint.
- Support non-streaming and streaming Anthropic-compatible responses while extracting route directives from assistant text.
- Reject unconfigured or untrusted route values so model output cannot choose arbitrary provider credentials, model names, or URLs.

## Capabilities

### New Capabilities
- `smart-model-routing`: Defines the local gateway behavior, route selection contract, upstream forwarding, directive validation, and route persistence.

### Modified Capabilities

## Impact

- Affected code: `src/server.js`, `router.config.example.json`, CLI/bootstrap scripts, tests, and README usage docs.
- APIs: local `POST /v1/messages` Anthropic-compatible endpoint and `GET /health` router status endpoint.
- Configuration: local route definitions for expensive/control and cheap/execution model categories.
- Tests: integration coverage with fake upstreams for route forwarding, directive parsing, persistence, and invalid directive handling.
