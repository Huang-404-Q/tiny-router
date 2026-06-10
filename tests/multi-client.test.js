import http from 'node:http';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';

const routerPort = 4577;
const upstreamAPort = 4578;
const upstreamBPort = 4579;
const tempDir = await mkdtemp(join(tmpdir(), 'tiny-router-multi-client-'));

const clientAConfigPath = join(tempDir, 'client-a', 'router.config.json');
const clientBConfigPath = join(tempDir, 'client-b', 'router.config.json');
const gatewayConfigPath = join(tempDir, 'gateway.config.json');

await mkdir(join(tempDir, 'client-a'), { recursive: true });
await mkdir(join(tempDir, 'client-b'), { recursive: true });

const upstreamA = await startFakeUpstream({
  port: upstreamAPort,
  model: 'model-a',
  nextDirective: { route: 'execution', reason: 'narrow' }
});
const upstreamB = await startFakeUpstream({
  port: upstreamBPort,
  model: 'model-b',
  nextDirective: { route: 'control', reason: 'broad' }
});

await writeFile(clientAConfigPath, JSON.stringify({
  defaultRoute: 'control',
  stateFile: '.router-state.json',
  routeInstruction: 'test instruction a',
  upstreams: {
    control: {
      baseUrl: `http://127.0.0.1:${upstreamAPort}`,
      apiKey: 'key-a',
      model: 'model-a'
    },
    execution: {
      baseUrl: `http://127.0.0.1:${upstreamBPort}`,
      apiKey: 'key-b',
      model: 'model-b'
    }
  }
}, null, 2));

await writeFile(clientBConfigPath, JSON.stringify({
  defaultRoute: 'execution',
  stateFile: '.router-state.json',
  routeInstruction: 'test instruction b',
  upstreams: {
    control: {
      baseUrl: `http://127.0.0.1:${upstreamAPort}`,
      apiKey: 'key-a',
      model: 'model-a'
    },
    execution: {
      baseUrl: `http://127.0.0.1:${upstreamBPort}`,
      apiKey: 'key-b',
      model: 'model-b'
    }
  }
}, null, 2));

await writeFile(gatewayConfigPath, JSON.stringify({
  listen: { host: '127.0.0.1', port: routerPort },
  clients: {
    'project-a': {
      apiKey: 'router-token-a',
      config: clientAConfigPath
    },
    'project-b': {
      apiKey: 'router-token-b',
      config: clientBConfigPath
    }
  }
}, null, 2));

const router = spawn(process.execPath, ['src/server.js'], {
  cwd: process.cwd(),
  env: { ...process.env, TINY_ROUTER_CONFIG: gatewayConfigPath },
  stdio: ['ignore', 'pipe', 'pipe']
});

let routerOutput = '';
router.stdout.on('data', (chunk) => {
  routerOutput += chunk.toString();
});
router.stderr.on('data', (chunk) => {
  routerOutput += chunk.toString();
});

try {
  await waitForHealth();

  const healthA = await fetchHealth('router-token-a');
  assert.equal(healthA.client, 'project-a');
  assert.equal(healthA.nextRoute, 'control');
  assert.equal(healthA.nextModel, 'model-a');

  const healthB = await fetchHealth('router-token-b');
  assert.equal(healthB.client, 'project-b');
  assert.equal(healthB.nextRoute, 'execution');
  assert.equal(healthB.nextModel, 'model-b');

  const unauthorized = await fetch(`http://127.0.0.1:${routerPort}/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': 'bad-token' },
    body: '{}'
  });
  assert.equal(unauthorized.status, 401);

  const msgA1 = await sendMessage('first a', 'router-token-a');
  assert.equal(msgA1.body.model, 'model-a');

  const msgB1 = await sendMessage('first b', 'router-token-b');
  assert.equal(msgB1.body.model, 'model-b');

  const healthA2 = await fetchHealth('router-token-a');
  assert.equal(healthA2.nextRoute, 'execution');

  const healthB2 = await fetchHealth('router-token-b');
  assert.equal(healthB2.nextRoute, 'control');

  console.log('multi-client integration test passed');
} finally {
  router.kill();
  upstreamA.close();
  upstreamB.close();
}

async function startFakeUpstream({ port, model, nextDirective }) {
  const server = http.createServer(async (req, res) => {
    const body = JSON.parse(await readRequestBody(req));
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      id: `msg_${model}`,
      type: 'message',
      role: 'assistant',
      model,
      content: [{
        type: 'text',
        text: `ok from ${model}\n${JSON.stringify(nextDirective)}`
      }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 1, output_tokens: 1 }
    }));
  });

  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  return server;
}

async function readRequestBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function waitForHealth() {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${routerPort}/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`router did not start:\n${routerOutput}`);
}

async function fetchHealth(token) {
  const response = await fetch(`http://127.0.0.1:${routerPort}/health`, {
    headers: { 'x-api-key': token }
  });
  assert.equal(response.status, 200);
  return response.json();
}

async function sendMessage(content, token) {
  const response = await fetch(`http://127.0.0.1:${routerPort}/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': token },
    body: JSON.stringify({
      model: 'client-requested-model',
      max_tokens: 64,
      messages: [{ role: 'user', content }]
    })
  });

  assert.equal(response.status, 200);
  const body = await response.json();
  const health = await fetchHealth(token);
  return { body, health };
}
