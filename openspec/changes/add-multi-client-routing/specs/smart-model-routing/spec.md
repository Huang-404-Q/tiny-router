## MODIFIED Requirements

### Requirement: Local Anthropic-compatible gateway
The system SHALL expose a local Anthropic-compatible `POST /v1/messages` endpoint that forwards requests to a configured upstream route for the authenticated client.

#### Scenario: Supported messages request
- **WHEN** a client sends a valid `POST /v1/messages` request to the local gateway with a recognized router token
- **THEN** the system SHALL resolve that token to a client routing context and forward the request to that client's currently selected upstream route's `/v1/messages` endpoint

#### Scenario: Unsupported endpoint
- **WHEN** a client sends a request to an unsupported method or path
- **THEN** the system SHALL return a not-found error response

#### Scenario: Single-config compatibility request
- **WHEN** the gateway config does not define `clients` and a client sends a valid `POST /v1/messages` request using the configured `routerApiKey`
- **THEN** the system SHALL route the request using the gateway config's own route definitions and state behavior

### Requirement: Configured route privacy
The system SHALL keep upstream base URLs, API keys, and provider model names in local route configuration files and SHALL expose only configured route names and client-safe status fields to assistant-controlled output.

#### Scenario: Forwarding to upstream provider
- **WHEN** the gateway forwards a request through a selected route for an authenticated client
- **THEN** the system SHALL replace the client-requested model with the configured upstream model for that route and attach the configured upstream authentication header

#### Scenario: Assistant outputs provider details
- **WHEN** assistant text contains an unconfigured route, arbitrary model ID, base URL, or credential-like value
- **THEN** the system SHALL ignore that directive and SHALL NOT persist it as the next route

#### Scenario: Unknown router token
- **WHEN** a request includes a router token that is not configured for any client and does not match single-config mode
- **THEN** the system SHALL reject the request without exposing any upstream provider credentials or model configuration

### Requirement: Persistent route state
The system SHALL persist the selected next route locally per routing context so independent clients do not overwrite each other's next-route state.

#### Scenario: Gateway starts with existing state
- **WHEN** the gateway handles a request for a client whose valid state file exists
- **THEN** the system SHALL use the persisted route as that client's current next route

#### Scenario: Gateway starts without valid state
- **WHEN** the gateway handles a request for a client whose valid state file does not exist
- **THEN** the system SHALL use that client's configured default route

#### Scenario: Two clients switch routes independently
- **WHEN** client A receives a valid route directive and client B receives no route directive
- **THEN** the system SHALL update only client A's next-route state and SHALL leave client B's next-route state unchanged

### Requirement: Router health visibility
The system SHALL expose a local health endpoint that reports whether the gateway is running and, when authenticated, which route and upstream model are currently selected for the calling client.

#### Scenario: Health check in single-config mode
- **WHEN** a client sends `GET /health` to a single-config gateway
- **THEN** the system SHALL return a successful JSON response containing `ok: true`, the current next route, and the current next upstream model when available

#### Scenario: Health check in multi-client mode with valid token
- **WHEN** a client sends `GET /health` with a recognized router token
- **THEN** the system SHALL return a successful JSON response containing `ok: true`, the client name, current next route, current next upstream model, and route reason when available

#### Scenario: Health check in multi-client mode without valid token
- **WHEN** a caller sends `GET /health` without a recognized router token
- **THEN** the system SHALL return gateway-level health without exposing client-specific route or model details

## ADDED Requirements

### Requirement: Multi-client configuration
The system SHALL support an optional central `clients` mapping that associates local router tokens with client names and project-specific route config files.

#### Scenario: Client token resolves to project config
- **WHEN** a request includes a router token configured under `clients`
- **THEN** the system SHALL load the route configuration file associated with that client token

#### Scenario: Multiple client configs exist
- **WHEN** two configured clients use different route config files
- **THEN** the system SHALL route each request using only the config associated with that request's router token

#### Scenario: Missing client config file
- **WHEN** a request resolves to a client whose config file cannot be read
- **THEN** the system SHALL return a clear router error identifying the client and missing config path without exposing upstream secrets

### Requirement: Opt-in terminal routing
The system SHALL keep tiny-router usage opt-in per terminal by requiring Claude Code sessions to set the gateway base URL and a local router token.

#### Scenario: Terminal opts into tiny-router
- **WHEN** a Claude Code terminal starts with `ANTHROPIC_BASE_URL` pointing at tiny-router and `ANTHROPIC_API_KEY` set to a configured router token
- **THEN** that terminal's requests SHALL be routed through tiny-router using the token's client config

#### Scenario: Terminal does not opt into tiny-router
- **WHEN** a Claude Code terminal starts without `ANTHROPIC_BASE_URL` pointing at tiny-router
- **THEN** that terminal SHALL NOT be affected by tiny-router configuration or state

### Requirement: Statusline client display
The project statusline helper SHALL display the tiny-router next route and upstream model for the current Claude Code terminal's router token when available.

#### Scenario: Statusline with valid token
- **WHEN** the statusline helper runs in a Claude Code process configured with a valid tiny-router token
- **THEN** it SHALL display the client name when available, the current next route, and the current next upstream model

#### Scenario: Statusline without router token
- **WHEN** the statusline helper runs without tiny-router environment variables or with an unknown router token
- **THEN** it SHALL display a concise not-configured or not-routed status rather than failing
