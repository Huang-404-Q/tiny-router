## Context

`tiny-router` currently has one active route configuration and one route state file per gateway process. That works for a single terminal, but it makes the user choose between sharing one config across all Claude Code terminals or running multiple gateway processes. The desired behavior is one global gateway that multiple terminals can explicitly opt into, with each terminal identified by its local router token.

The user's mental model is:

```text
Terminal A sets ANTHROPIC_API_KEY=<token-a> -> gateway uses project A config/state
Terminal B sets ANTHROPIC_API_KEY=<token-b> -> gateway uses project B config/state
Plain claude without ANTHROPIC_BASE_URL        -> bypasses tiny-router entirely
```

The router token is not an upstream provider API key. It is a local gateway credential used to identify which client config to use.

## Goals / Non-Goals

**Goals:**

- Let one tiny-router process serve multiple Claude Code terminals.
- Let each terminal opt in by setting `ANTHROPIC_BASE_URL` and a client-specific `ANTHROPIC_API_KEY`.
- Map each local token to a client name and a project-specific router config file.
- Keep each client route state independent.
- Keep existing single-config mode working so current users are not forced to migrate immediately.
- Make `/health` and the statusline script report the route/model for the calling client token.
- Document clearly where the local gateway config lives, where per-project configs live, and what each key means.

**Non-Goals:**

- Building remote multi-user authentication.
- Sending project config paths directly from Claude Code on every request.
- Making all Claude Code sessions globally route through tiny-router.
- Providing cost metrics or dashboards in this change.
- Encrypting local config files at rest.

## Decisions

### Add a central clients map

The gateway config can contain an optional `clients` map:

```json
{
  "listen": { "host": "127.0.0.1", "port": 3456 },
  "clients": {
    "project-a": {
      "apiKey": "router-token-project-a",
      "config": "D:/workplace/project-a/router.config.json"
    },
    "project-b": {
      "apiKey": "router-token-project-b",
      "config": "D:/workplace/project-b/router.config.json"
    }
  }
}
```

Each referenced config uses the existing route schema: `defaultRoute`, `stateFile`, `routeInstruction`, and `upstreams`.

Alternatives considered:

- Infer config from Claude Code working directory: not reliable because the Anthropic-compatible request does not include cwd.
- Start one gateway per project: simpler to reason about, but creates port conflicts and more processes.
- Encode config path directly in `ANTHROPIC_API_KEY`: convenient but leaks local paths into process listings and is harder to document safely.

### Keep single-config mode as compatibility mode

If `clients` is absent, the gateway behaves as it does today: authenticate with `routerApiKey`, read routes from the main config, and use one state file.

Alternatives considered:

- Make `clients` required: cleaner internally, but too abrupt for existing README/config users.

### Load client configs by token per request

For each request, the gateway reads `x-api-key`, resolves the client, loads that client's route config, and then routes using that client's state. The implementation can cache parsed configs later, but correctness should not depend on cache freshness.

Alternatives considered:

- Preload all configs once at startup: faster, but edits to project configs require gateway restart.
- Require client name in a custom header: Claude Code cannot conveniently add custom headers in this flow.

### Derive default state path per client when absent

If a client config has `stateFile`, use it relative to that client config file's directory. If absent, create a gateway-local state file such as `.router-state.<client-name>.json` or use a deterministic path under a router state directory.

Alternatives considered:

- Always write `.router-state.json` beside each project config: intuitive, but may create ignored files inside many unrelated repos.
- Require `stateFile` for every client: explicit, but tedious.

### Make `/health` token-aware

`GET /health` should accept the same `x-api-key` token as `/v1/messages`. In multi-client mode, it returns that client's current route and model. Without a valid token, it should not expose client-specific details.

Alternatives considered:

- Return all clients from `/health`: convenient for debugging, but leaks project names and model configuration to any local caller.

## Risks / Trade-offs

- Confusing key terminology -> README must distinguish router token from upstream provider API key with examples.
- Broken client config path -> Return a clear router error naming the client and config path without exposing upstream secrets.
- Config edits during active requests -> Load per request for simple correctness; future caching can add mtime checks.
- Multiple terminals sharing one token -> They intentionally share route state; docs should say use different tokens for independent terminals/projects.
- Statusline cannot know token -> It can read `ANTHROPIC_API_KEY` from the Claude Code process environment and call `/health` with it.
