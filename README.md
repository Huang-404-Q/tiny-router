# tiny-router

A tiny Anthropic-compatible gateway for Claude Code routing experiments.

Claude Code talks only to this local server. The router forwards each `/v1/messages` request to route `A` or `B`, then lets the assistant choose the next route by appending a JSON directive at the end of the response.

```json
{"model":"B","reason":"local code edit"}
```

The router treats that directive as a whitelist state update only. Real upstream `baseUrl`, API keys, and model names stay in local config and are never trusted from model output.

## Why

Use a stronger or more expensive model for planning, architecture, and difficult debugging, then let the conversation switch itself to a cheaper model for narrow implementation work.

This is experimental. It may reduce cost for some workflows, but it is not a guarantee.

## Requirements

- Node.js 18+
- Claude Code or another client that can use an Anthropic-compatible `/v1/messages` endpoint

## Setup

Copy the example config:

```sh
cp router.config.example.json router.config.json
```

Edit `router.config.json` with your own upstreams:

```json
{
  "listen": {
    "host": "127.0.0.1",
    "port": 3456
  },
  "routerApiKey": "local-router-key",
  "defaultRoute": "A",
  "upstreams": {
    "A": {
      "baseUrl": "https://expensive-provider.example.com",
      "apiKey": "your-expensive-provider-key",
      "model": "expensive-model-name"
    },
    "B": {
      "baseUrl": "https://cheap-provider.example.com",
      "apiKey": "your-cheap-provider-key",
      "model": "cheap-model-name"
    }
  }
}
```

You can also use Claude Code-style env blocks:

```json
{
  "upstreams": {
    "A": {
      "env": {
        "ANTHROPIC_AUTH_TOKEN": "your-provider-key",
        "ANTHROPIC_BASE_URL": "https://provider.example.com",
        "ANTHROPIC_MODEL": "model-name"
      }
    }
  }
}
```

Start the gateway:

```sh
npm start
```

Point Claude Code at it:

```sh
ANTHROPIC_BASE_URL=http://127.0.0.1:3456 ANTHROPIC_API_KEY=local-router-key claude
```

On Windows PowerShell:

```powershell
$env:ANTHROPIC_BASE_URL="http://127.0.0.1:3456"
$env:ANTHROPIC_API_KEY="local-router-key"
claude
```

## Behavior

- Supports `POST /v1/messages`.
- Supports normal JSON responses and streaming SSE responses.
- Replaces the request `model` with the configured model for the current route.
- Appends a route instruction to the system prompt by default.
- Accepts only `A` or `B` from the assistant directive.
- Keeps the previous route if the directive is missing or invalid.
- Writes route state to `.router-state.json` by default.
- Preserves upstream paths, so a base URL like `https://api.example.com/coding` becomes `https://api.example.com/coding/v1/messages`.

## Security Notes

- Do not commit `router.config.json` or any real API keys.
- Do not expose this router to the public internet.
- Keep `listen.host` set to `127.0.0.1` unless you know exactly what you are doing.
- The assistant can only choose `A` or `B`; it cannot choose a real model name, API key, or base URL.
- Rotate any key that was committed, logged publicly, or pasted into a public issue.

## Check

Run syntax checks:

```sh
npm run check
```

Run the fake upstream integration test:

```sh
npm test
```

The test starts two local fake upstreams and verifies route switching, model rewriting, invalid route fallback, and upstream path handling.

## License

MIT
