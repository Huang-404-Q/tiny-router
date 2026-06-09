# tiny-router

English | [中文](#中文)

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

# 中文

[English](#tiny-router) | 中文

一个很小的 Anthropic-compatible gateway，用来做 Claude Code 的模型路由实验。

Claude Code 只连接这个本地服务。router 会把每一轮 `/v1/messages` 请求转发到 route `A` 或 `B`，然后让 assistant 在回复末尾追加一个 JSON 指令，用来选择下一轮 route。

```json
{"model":"B","reason":"local code edit"}
```

router 只把这个 JSON 当成白名单状态更新。真实的上游 `baseUrl`、API key、模型名都只保存在本地配置里，永远不相信模型输出里的真实上游信息。

## 为什么

你可以用更强或更贵的模型处理规划、架构、复杂 debug，然后让同一个 Claude Code 会话自动切到更便宜的模型处理局部实现、跑命令、补测试等窄任务。

这是一个实验项目。它可能在某些工作流里降低成本，但不保证一定省钱。

## 要求

- Node.js 18+
- Claude Code，或者其他能使用 Anthropic-compatible `/v1/messages` endpoint 的客户端

## 配置

复制配置模板：

```sh
cp router.config.example.json router.config.json
```

编辑 `router.config.json`，填入你自己的上游：

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

也可以使用 Claude Code 风格的 `env` 配置：

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

启动 gateway：

```sh
npm start
```

让 Claude Code 连接本地 router：

```sh
ANTHROPIC_BASE_URL=http://127.0.0.1:3456 ANTHROPIC_API_KEY=local-router-key claude
```

Windows PowerShell：

```powershell
$env:ANTHROPIC_BASE_URL="http://127.0.0.1:3456"
$env:ANTHROPIC_API_KEY="local-router-key"
claude
```

## 行为

- 支持 `POST /v1/messages`。
- 支持普通 JSON 响应和 streaming SSE 响应。
- 会把请求里的 `model` 替换成当前 route 在本地配置里的真实模型名。
- 默认会往 system prompt 里追加 route 选择说明。
- 只接受 assistant 指令里的 `A` 或 `B`。
- 如果指令缺失或非法，就保持上一轮 route 不变。
- 默认把 route 状态写入 `.router-state.json`。
- 会保留上游路径，例如 `https://api.example.com/coding` 会变成 `https://api.example.com/coding/v1/messages`。

## 安全说明

- 不要提交 `router.config.json` 或任何真实 API key。
- 不要把这个 router 暴露到公网。
- 除非你非常清楚自己在做什么，否则保持 `listen.host` 为 `127.0.0.1`。
- assistant 只能选择 `A` 或 `B`，不能选择真实模型名、API key 或 base URL。
- 任何已经提交、公开日志记录、或贴到公开 issue 里的 key 都应该轮换。

## 检查

运行语法检查：

```sh
npm run check
```

运行 fake upstream 集成测试：

```sh
npm test
```

测试会启动两个本地 fake upstream，验证 route 切换、模型名重写、非法 route fallback、以及上游路径拼接。

## License

MIT
