import http from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const gatewayConfigPath = resolve(process.env.TINY_ROUTER_CONFIG || 'router.config.json');

const hopByHopHeaders = new Set([
  'content-encoding',
  'content-length',
  'host',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade'
]);

const gatewayConfig = await loadGatewayConfig();
const clientManager = await buildClientManager(gatewayConfig);

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/health') {
      await handleHealth(req, res);
      return;
    }

    if (req.method !== 'POST' || req.url !== '/v1/messages') {
      sendJson(res, 404, { error: { type: 'not_found_error', message: 'Only POST /v1/messages is supported.' } });
      return;
    }

    await handleMessages(req, res);
  } catch (error) {
    sendJson(res, 500, { error: { type: 'router_error', message: error.message } });
  }
});

server.listen(gatewayConfig.listen?.port || 3456, gatewayConfig.listen?.host || '127.0.0.1', () => {
  const address = server.address();
  console.log(`tiny-router listening on http://${address.address}:${address.port}`);
  console.log(`mode: ${clientManager.multi ? 'multi-client' : 'single'}`);
  if (!clientManager.multi) {
    console.log(`next route: ${clientManager.default.routeState.nextRoute}`);
  }
});

async function loadGatewayConfig() {
  if (!existsSync(gatewayConfigPath)) {
    throw new Error(`Missing config file: ${gatewayConfigPath}. Copy router.config.example.json to router.config.json first.`);
  }

  const raw = await readFile(gatewayConfigPath, 'utf8');
  return JSON.parse(raw);
}

async function buildClientManager(gatewayConfig) {
  if (gatewayConfig.clients && typeof gatewayConfig.clients === 'object') {
    const clients = new Map();
    for (const [name, clientDef] of Object.entries(gatewayConfig.clients)) {
      const clientConfigPath = resolve(dirname(gatewayConfigPath), clientDef.config);
      const clientConfig = normalizeConfig(await loadClientConfig(clientConfigPath));
      const statePath = resolveClientStatePath(clientConfigPath, clientConfig, name);
      const routeState = await loadRouteState(statePath, clientConfig.defaultRoute, clientConfig.routeNames);
      const ctx = createClientContext(name, clientConfig, statePath, routeState);
      clients.set(clientDef.apiKey, ctx);
    }
    return { multi: true, clients };
  }

  const singleConfig = normalizeConfig(gatewayConfig);
  const statePath = resolve(rootDir, singleConfig.stateFile || '.router-state.json');
  const routeState = await loadRouteState(statePath, singleConfig.defaultRoute, singleConfig.routeNames);
  const ctx = createClientContext('default', singleConfig, statePath, routeState);
  return { multi: false, clients: new Map(), default: ctx };
}

function createClientContext(name, config, statePath, routeState) {
  const ctx = {
    name,
    config,
    statePath,
    routeState
  };

  ctx.saveRouteState = async (route, reason) => {
    const normalized = normalizeRoute(route, ctx.config.routeNames);
    if (!normalized) return;

    ctx.routeState = {
      nextRoute: normalized,
      reason: String(reason || ''),
      updatedAt: new Date().toISOString()
    };
    await writeFile(ctx.statePath, JSON.stringify(ctx.routeState, null, 2));
    console.log(`[${ctx.name}] next route set to ${ctx.routeState.nextRoute}${reason ? `: ${reason}` : ''}`);
  };

  return ctx;
}

async function loadClientConfig(clientConfigPath) {
  if (!existsSync(clientConfigPath)) {
    throw new Error(`Missing client config file: ${clientConfigPath}`);
  }

  const raw = await readFile(clientConfigPath, 'utf8');
  return JSON.parse(raw);
}

function resolveClientStatePath(clientConfigPath, clientConfig, clientName) {
  if (clientConfig.stateFile) {
    return resolve(dirname(clientConfigPath), clientConfig.stateFile);
  }
  return resolve(rootDir, `.router-state.${clientName}.json`);
}

function normalizeConfig(rawConfig) {
  const upstreams = Object.fromEntries(
    Object.entries(rawConfig.upstreams || {}).map(([route, upstream]) => [route, normalizeUpstream(upstream)])
  );
  const routeNames = Object.keys(upstreams);
  const defaultRoute = normalizeRoute(rawConfig.defaultRoute, routeNames) || routeNames[0];

  if (!defaultRoute) throw new Error('Config must define at least one upstream route.');

  return {
    ...rawConfig,
    defaultRoute,
    routeNames,
    upstreams
  };
}

function normalizeUpstream(upstream) {
  const env = upstream.env || {};
  return {
    baseUrl: upstream.baseUrl || env.ANTHROPIC_BASE_URL,
    apiKey: upstream.apiKey || upstream.authToken || env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_API_KEY,
    model: upstream.model || env.ANTHROPIC_MODEL || env.ANTHROPIC_DEFAULT_OPUS_MODEL || env.ANTHROPIC_DEFAULT_SONNET_MODEL || env.ANTHROPIC_DEFAULT_HAIKU_MODEL
  };
}

async function loadRouteState(statePath, defaultRoute, routeNames) {
  try {
    const state = JSON.parse(await readFile(statePath, 'utf8'));
    const nextRoute = normalizeRoute(state.nextRoute, routeNames) || normalizeRoute(defaultRoute, routeNames);
    return {
      nextRoute,
      reason: nextRoute === state.nextRoute ? String(state.reason || '') : '',
      updatedAt: nextRoute === state.nextRoute ? state.updatedAt : undefined
    };
  } catch {
    return { nextRoute: normalizeRoute(defaultRoute, routeNames), reason: '', updatedAt: undefined };
  }
}

function normalizeRoute(value, routeNames) {
  return typeof value === 'string' && routeNames.includes(value) ? value : null;
}

async function handleHealth(req, res) {
  const token = req.headers['x-api-key'] || '';
  const client = clientManager.multi
    ? clientManager.clients.get(token)
    : clientManager.default;

  if (clientManager.multi && !client) {
    sendJson(res, 200, { ok: true, mode: 'multi-client', clients: clientManager.clients.size });
    return;
  }

  if (!client) {
    sendJson(res, 200, { ok: true });
    return;
  }

  const route = normalizeRoute(client.routeState.nextRoute, client.config.routeNames) || normalizeRoute(client.config.defaultRoute, client.config.routeNames);
  const upstream = client.config.upstreams?.[route];
  const model = upstream?.model || 'unknown model';

  sendJson(res, 200, {
    ok: true,
    client: client.name,
    nextRoute: route,
    nextModel: model,
    reason: client.routeState.reason,
    updatedAt: client.routeState.updatedAt
  });
}

async function handleMessages(req, res) {
  const token = req.headers['x-api-key'] || '';
  const client = clientManager.multi
    ? clientManager.clients.get(token)
    : clientManager.default;

  if (clientManager.multi && !client) {
    sendJson(res, 401, { error: { type: 'authentication_error', message: 'Invalid router API key.' } });
    return;
  }

  if (!clientManager.multi && client.config.routerApiKey && token !== client.config.routerApiKey) {
    sendJson(res, 401, { error: { type: 'authentication_error', message: 'Invalid router API key.' } });
    return;
  }

  const incomingBody = await readJsonBody(req);
  const route = normalizeRoute(client.routeState.nextRoute, client.config.routeNames) || normalizeRoute(client.config.defaultRoute, client.config.routeNames);
  const upstream = client.config.upstreams?.[route];
  if (!upstream) {
    sendJson(res, 500, { error: { type: 'router_error', message: `Route ${route} has no upstream config.` } });
    return;
  }

  const upstreamBody = prepareUpstreamBody(incomingBody, upstream.model, client.config);
  const upstreamResponse = await fetch(buildMessagesUrl(upstream.baseUrl), {
    method: 'POST',
    headers: buildUpstreamHeaders(req.headers, upstream.apiKey),
    body: JSON.stringify(upstreamBody)
  });

  if (incomingBody.stream === true) {
    await proxyStreamingResponse(upstreamResponse, res, client);
    return;
  }

  await proxyJsonResponse(upstreamResponse, res, client);
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function prepareUpstreamBody(body, model, routeConfig) {
  const nextBody = { ...body, model };
  if (routeConfig.injectRouteInstruction !== false && routeConfig.routeInstruction) {
    nextBody.system = appendSystemInstruction(nextBody.system, routeConfig.routeInstruction);
  }
  return nextBody;
}

function appendSystemInstruction(system, instruction) {
  if (!system) return instruction;
  if (typeof system === 'string') return `${system}\n\n${instruction}`;
  if (Array.isArray(system)) return [...system, { type: 'text', text: instruction }];
  return system;
}

function buildMessagesUrl(baseUrl) {
  const url = new URL(baseUrl);
  const pathname = url.pathname.replace(/\/$/, '');
  url.pathname = pathname.endsWith('/v1/messages') ? pathname : `${pathname}/v1/messages`;
  return url;
}

function buildUpstreamHeaders(incomingHeaders, apiKey) {
  const headers = {};
  for (const [key, value] of Object.entries(incomingHeaders)) {
    if (!hopByHopHeaders.has(key.toLowerCase()) && value !== undefined) headers[key] = value;
  }

  headers['content-type'] = 'application/json';
  headers['x-api-key'] = apiKey;
  return headers;
}

async function proxyJsonResponse(upstreamResponse, res, client) {
  const responseText = await upstreamResponse.text();
  copyResponseHeaders(upstreamResponse, res);
  res.writeHead(upstreamResponse.status);
  res.end(responseText);

  if (!upstreamResponse.ok) return;
  const responseJson = JSON.parse(responseText);
  await updateRouteFromAssistantText(extractTextFromMessage(responseJson), client);
}

async function proxyStreamingResponse(upstreamResponse, res, client) {
  copyResponseHeaders(upstreamResponse, res);
  res.writeHead(upstreamResponse.status);

  if (!upstreamResponse.body) {
    res.end();
    return;
  }

  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let assistantText = '';
  let sseBuffer = '';

  for await (const chunk of upstreamResponse.body) {
    const text = decoder.decode(chunk, { stream: true });
    const extracted = extractTextFromSseChunk(sseBuffer + text);
    assistantText += extracted.text;
    sseBuffer = extracted.remainder;
    res.write(encoder.encode(text));
  }

  const finalText = extractTextFromSseChunk(sseBuffer + decoder.decode());
  assistantText += finalText.text;

  res.end();
  if (upstreamResponse.ok) await updateRouteFromAssistantText(assistantText, client);
}

function copyResponseHeaders(upstreamResponse, res) {
  upstreamResponse.headers.forEach((value, key) => {
    if (!hopByHopHeaders.has(key.toLowerCase())) res.setHeader(key, value);
  });
}

function extractTextFromMessage(message) {
  if (!Array.isArray(message.content)) return '';
  return message.content.filter((block) => block?.type === 'text').map((block) => block.text || '').join('\n');
}

function extractTextFromSseChunk(chunk) {
  let text = '';
  const lines = chunk.split('\n');
  const remainder = chunk.endsWith('\n') ? '' : lines.pop() || '';

  for (const line of lines) {
    if (!line.startsWith('data: ')) continue;
    const data = line.slice(6).trim();
    if (!data || data === '[DONE]') continue;

    try {
      const event = JSON.parse(data);
      if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
        text += event.delta.text || '';
      }
    } catch {}
  }
  return { text, remainder };
}

async function updateRouteFromAssistantText(text, client) {
  const directive = parseRouteDirective(text, client);
  if (directive) await client.saveRouteState(directive.route, directive.reason);
}

function parseRouteDirective(text, client) {
  const lines = String(text || '').trim().split('\n').map((line) => line.trim()).filter(Boolean);

  for (const line of lines.reverse()) {
    if (!line.startsWith('{') || !line.endsWith('}')) continue;

    try {
      const parsed = JSON.parse(line);
      const route = parsed.route || parsed.model;
      if (normalizeRoute(route, client.config.routeNames)) return { route, reason: parsed.reason };
    } catch {}
  }

  return null;
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}
