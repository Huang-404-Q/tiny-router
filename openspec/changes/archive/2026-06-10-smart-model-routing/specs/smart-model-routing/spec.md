## ADDED Requirements

### Requirement: Local Anthropic-compatible gateway
The system SHALL expose a local Anthropic-compatible `POST /v1/messages` endpoint that forwards requests to a configured upstream route.

#### Scenario: Supported messages request
- **WHEN** a client sends a valid `POST /v1/messages` request to the local gateway
- **THEN** the system SHALL forward the request to the currently selected upstream route's `/v1/messages` endpoint

#### Scenario: Unsupported endpoint
- **WHEN** a client sends a request to an unsupported method or path
- **THEN** the system SHALL return a not-found error response

### Requirement: Configured route privacy
The system SHALL keep upstream base URLs, API keys, and provider model names in local configuration and SHALL expose only route names to assistant-controlled output.

#### Scenario: Forwarding to upstream provider
- **WHEN** the gateway forwards a request through a selected route
- **THEN** the system SHALL replace the client-requested model with the configured upstream model for that route and attach the configured upstream authentication header

#### Scenario: Assistant outputs provider details
- **WHEN** assistant text contains an unconfigured route, arbitrary model ID, base URL, or credential-like value
- **THEN** the system SHALL ignore that directive and SHALL NOT persist it as the next route

### Requirement: Assistant-directed next-route selection
The system SHALL let the assistant choose the next request's route by ending its response with a valid JSON directive containing a configured route name.

#### Scenario: Valid route directive
- **WHEN** an upstream assistant response ends with a JSON directive containing a configured route name and optional reason
- **THEN** the system SHALL persist that route as the next route and store the reason for observability

#### Scenario: Invalid route directive
- **WHEN** an upstream assistant response contains a JSON directive with an unconfigured route name
- **THEN** the system SHALL keep the previous next route unchanged

#### Scenario: Missing route directive
- **WHEN** an upstream assistant response contains no valid route directive
- **THEN** the system SHALL keep the previous next route unchanged

### Requirement: Routing guidance injection
The system SHALL be able to inject routing guidance into each upstream request so the assistant knows the valid route names and directive format.

#### Scenario: Injection enabled
- **WHEN** route instruction injection is enabled and a request is forwarded upstream
- **THEN** the system SHALL append the configured route instruction to the upstream request's system prompt

#### Scenario: Injection disabled
- **WHEN** route instruction injection is disabled and a request is forwarded upstream
- **THEN** the system SHALL NOT modify the request's system prompt for routing guidance

### Requirement: Persistent route state
The system SHALL persist the selected next route locally so routing survives gateway restarts.

#### Scenario: Gateway starts with existing state
- **WHEN** the gateway starts and a valid state file exists
- **THEN** the system SHALL use the persisted route as the current next route

#### Scenario: Gateway starts without valid state
- **WHEN** the gateway starts and no valid state file exists
- **THEN** the system SHALL use the configured default route

### Requirement: Router health visibility
The system SHALL expose a local health endpoint that reports whether the gateway is running and which route is currently selected for the next request.

#### Scenario: Health check
- **WHEN** a client sends `GET /health` to the local gateway
- **THEN** the system SHALL return a successful JSON response containing `ok: true` and the current next route

### Requirement: Streaming response support
The system SHALL proxy streaming Anthropic-compatible responses while still extracting valid route directives from streamed assistant text.

#### Scenario: Streaming request
- **WHEN** a client sends a `/v1/messages` request with streaming enabled
- **THEN** the system SHALL stream upstream events through to the client without waiting for the full response body

#### Scenario: Streaming route directive
- **WHEN** a streamed assistant response contains a valid route directive in text deltas
- **THEN** the system SHALL persist the selected route after the upstream stream completes

### Requirement: Integration test coverage
The system SHALL include fake-upstream integration tests for route forwarding, model replacement, route persistence, and invalid directive handling.

#### Scenario: Fake upstream route switch
- **WHEN** a fake expensive upstream responds with a directive selecting a cheap execution route
- **THEN** the next client request SHALL be forwarded to the cheap route and use that route's configured model

#### Scenario: Fake upstream invalid route
- **WHEN** a fake upstream responds with a directive selecting an unconfigured route
- **THEN** the persisted next route SHALL remain unchanged
