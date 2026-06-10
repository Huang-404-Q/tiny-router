## Context

`tiny-router` is a local Anthropic-compatible gateway intended to sit between Claude Code and one or more upstream model providers. The key product idea is not general load balancing: it is assistant-directed next-turn routing. A strong model can act as the controller for planning, architecture, and review, then mark the next turn for a cheaper execution route when the work is simple or localized.

The gateway must keep provider secrets and real model names in local config. The assistant should only see route categories such as `control` or `execution`, because model output is untrusted and must not be allowed to choose arbitrary upstream URLs, API keys, or provider model IDs.

## Goals / Non-Goals

**Goals:**

- Provide a small local HTTP gateway compatible with Claude Code's Anthropic `/v1/messages` usage.
- Route each request to the previously selected route, defaulting to a configured control route.
- Let the assistant select the next route by appending a JSON directive at the end of its response.
- Validate route directives against configured route names before persisting them.
- Keep upstream credentials, base URLs, and concrete model names private in local configuration.
- Preserve normal upstream responses for Claude Code, including streaming responses.
- Cover the core behavior with fake-upstream integration tests.

**Non-Goals:**

- Building a hosted multi-user proxy service.
- Estimating exact token costs or billing in this change.
- Supporting arbitrary provider-specific APIs beyond Anthropic-compatible `/v1/messages`.
- Automatically classifying task complexity inside the router without assistant participation.
- Providing a browser UI or long-term analytics dashboard.

## Decisions

### Route categories are local config keys

The router will use configured route names as the only valid routing surface. Suggested defaults can be `control` for expensive reasoning work and `execution` for cheaper implementation work, but the implementation should not hard-code only two route names.

Alternatives considered:

- Hard-code `A` and `B`: simpler, but awkward once users want clearer names or more than two model categories.
- Let the assistant output concrete model IDs: flexible, but unsafe because it exposes and trusts provider-level details.

### Directive is assistant text JSON at the end of the response

The assistant will choose the next route by ending a response with a compact JSON object such as:

```json
{"route":"execution","reason":"next step is a narrow file edit"}
```

For compatibility with earlier experiments, the parser can also accept `model` as an alias for `route`, but documentation should prefer `route` because this is a route category, not a provider model name.

Alternatives considered:

- Custom response headers: unavailable because the upstream LLM response body is what the model controls.
- Tool calls: richer, but Claude Code traffic through an Anthropic-compatible gateway must work without requiring an additional tool integration.

### The selected route applies to the next request

The current request is sent to the route stored in state before the request begins. Any directive in the assistant's response updates state for the next request.

Alternatives considered:

- Re-route the current request after seeing a directive: impossible because the directive only appears after upstream generation.
- Ask the client to resend: intrusive and incompatible with a transparent gateway.

### State is file-backed and minimal

Persist only the next route, reason, and timestamp in a local state file. This keeps behavior stable across router restarts without introducing a database.

Alternatives considered:

- In-memory only: simpler, but surprising after restarts.
- SQLite: useful for future logging or cost analytics, but unnecessary for the routing contract.

### Streaming responses are proxied while text is accumulated

For streaming requests, the router will pass SSE chunks through to the client while accumulating assistant text from `content_block_delta` events. After the upstream stream finishes, the router parses and persists any valid route directive.

Alternatives considered:

- Buffer the full stream before sending it to Claude Code: easier to parse, but breaks the streaming experience.
- Ignore directives in streaming mode: creates inconsistent behavior across request modes.

## Risks / Trade-offs

- Assistant forgets the directive -> The router keeps the previous route and the injected instruction reminds the assistant of valid routes.
- Cheap model gets stuck on hard work -> The assistant can route back to `control`; users can also edit or delete the state file to reset.
- Invalid or malicious directive -> The router validates against configured route names and ignores everything else.
- Directive appears in user-visible assistant text -> This is acceptable for the initial local experiment; future work can explore hiding or stripping directives if clients tolerate response mutation.
- Provider response formats vary -> Scope to Anthropic-compatible message JSON and SSE event shapes, with tests covering the expected format.
