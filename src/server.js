import http from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const configPath = resolve(process.env.TINY_ROUTER_CONFIG || 'router.config.json');

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

const config = normalizeConfig(await loadConfig());
const statePath = resolve(rootDir, config.stateFile || '.router-state.json');
let nextRoute = await loadRouteState(config.defaultRoute || 'A');

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/health') {
      sendJson(res, 200, { ok: true, nextRoute });
      return;
    }

    if (req.method !== 'POST' || req.url !== '/v1/messages') {
      sendJson(res, 404, { error: { type: 'not_found_error', message: 'Only POST /v1/messages is supported.' } });
      return;
    }

    if (config.routerApiKey && req.headers['x-api-key'] !== config.routerApiKey) {
      sendJson(res, 401, { error: { type: 'authentication_error', message: 'Invalid router API key.' } });
      return;
    }

    const incomingBody = await readJsonBody(req);
    const route = normalizeRoute(nextRoute) || normalizeRoute(config.defaultRoute) || 'A';
    const upstream = config.upstreams?.[route];
    if (!upstream) {
      sendJson(res, 500, { error: { type: 'router_error', message: `Route ${route} has no upstream config.` } });
      return;
    }

    const upstreamBody = prepareUpstreamBody(incomingBody, upstream.model);
    const upstreamResponse = await fetch(buildMessagesUrl(upstream.baseUrl), {
      method: 'POST',
      headers: buildUpstreamHeaders(req.headers, upstream.apiKey),
      body: JSON.stringify(upstreamBody)
    });

    if (incomingBody.stream === true) {
      await proxyStreamingResponse(upstreamResponse, res);
      return;
    }

    await proxyJsonResponse(upstreamResponse, res);
  } catch (error) {
    sendJson(res, 500, { error: { type: 'router_error', message: error.message } });
  }
});

server.listen(config.listen?.port || 3456, config.listen?.host || '127.0.0.1', () => {
  const address = server.address();
  console.log(`tiny-router listening on http://${address.address}:${address.port}`);
  console.log(`next route: ${nextRoute}`);
});

async function loadConfig() {
  if (!existsSync(configPath)) {
    throw new Error(`Missing config file: ${configPath}. Copy router.config.example.json to router.config.json first.`);
  }

  const raw = await readFile(configPath, 'utf8');
  return JSON.parse(raw);
}

function normalizeConfig(rawConfig) {
  return {
    ...rawConfig,
    upstreams: Object.fromEntries(
      Object.entries(rawConfig.upstreams || {}).map(([route, upstream]) => [route, normalizeUpstream(upstream)])
    )
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

async function loadRouteState(defaultRoute) {
  try {
    const state = JSON.parse(await readFile(statePath, 'utf8'));
    return normalizeRoute(state.nextRoute) || normalizeRoute(defaultRoute) || 'A';
  } catch {
    return normalizeRoute(defaultRoute) || 'A';
  }
}

async function saveRouteState(route, reason) {
  const normalized = normalizeRoute(route);
  if (!normalized) return;

  nextRoute = normalized;
  await writeFile(statePath, JSON.stringify({ nextRoute, reason: String(reason || ''), updatedAt: new Date().toISOString() }, null, 2));
  console.log(`next route set to ${nextRoute}${reason ? `: ${reason}` : ''}`);
}

function normalizeRoute(value) {
  return value === 'A' || value === 'B' ? value : null;
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function prepareUpstreamBody(body, model) {
  const nextBody = { ...body, model };
  if (config.injectRouteInstruction !== false && config.routeInstruction) {
    nextBody.system = appendSystemInstruction(nextBody.system, config.routeInstruction);
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

async function proxyJsonResponse(upstreamResponse, res) {
  const responseText = await upstreamResponse.text();
  copyResponseHeaders(upstreamResponse, res);
  res.writeHead(upstreamResponse.status);
  res.end(responseText);

  if (!upstreamResponse.ok) return;
  const responseJson = JSON.parse(responseText);
  await updateRouteFromAssistantText(extractTextFromMessage(responseJson));
}

async function proxyStreamingResponse(upstreamResponse, res) {
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
  if (upstreamResponse.ok) await updateRouteFromAssistantText(assistantText);
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

async function updateRouteFromAssistantText(text) {
  const directive = parseRouteDirective(text);
  if (directive) await saveRouteState(directive.model, directive.reason);
}

function parseRouteDirective(text) {
  const lines = String(text || '').trim().split('\n').map((line) => line.trim()).filter(Boolean);

  for (const line of lines.reverse()) {
    if (!line.startsWith('{') || !line.endsWith('}')) continue;

    try {
      const parsed = JSON.parse(line);
      if (normalizeRoute(parsed.model)) return parsed;
    } catch {}
  }

  return null;
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}
