## 1. Configuration and Route Model

- [x] 1.1 Replace fixed two-route validation with validation against configured route names.
- [x] 1.2 Support clear default route names such as `control` and `execution` in example configuration.
- [x] 1.3 Normalize upstream definitions from direct fields and Claude Code style env fields.
- [x] 1.4 Persist next route state with route, reason, and timestamp.

## 2. Request Forwarding

- [x] 2.1 Forward `POST /v1/messages` to the selected route's configured upstream `/v1/messages` URL.
- [x] 2.2 Replace the incoming model with the selected route's configured upstream model.
- [x] 2.3 Forward safe request headers and attach the selected upstream API key.
- [x] 2.4 Return clear local errors for unsupported endpoints, bad auth, and missing route config.

## 3. Assistant Route Directives

- [x] 3.1 Inject configurable routing guidance into upstream system prompts when enabled.
- [x] 3.2 Parse final assistant text JSON directives using `route` as the preferred key and `model` as a backward-compatible alias.
- [x] 3.3 Accept only configured route names and ignore invalid directives without changing state.
- [x] 3.4 Preserve the previous route when no valid directive is present.

## 4. Streaming and Observability

- [x] 4.1 Proxy streaming SSE responses through to the client as chunks arrive.
- [x] 4.2 Accumulate streamed assistant text and apply any valid route directive after stream completion.
- [x] 4.3 Expose `GET /health` with `ok: true`, the current next route, and useful state details.

## 5. Tests and Documentation

- [x] 5.1 Add fake-upstream integration coverage for default route forwarding and model replacement.
- [x] 5.2 Add integration coverage for valid directive route switching across requests.
- [x] 5.3 Add integration coverage for invalid directives being ignored.
- [x] 5.4 Add or update streaming coverage for directive parsing from SSE text deltas.
- [x] 5.5 Update README and example config to describe the control/execution routing workflow for Claude Code.
- [x] 5.6 Run syntax checks and the integration test suite.
