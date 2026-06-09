import http from 'node:http';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';

const routerPort = 4567;
const upstreamAPort = 4568;
const upstreamBPort = 4569;
const routerKey = 'test-router-key';
const tempDir = await mkdtemp(join(tmpdir(), 'tiny-router-test-'));
const configPath = join(tempDir, 'router.config.json');
const statePath = join(tempDir, 'router-state.json');
const upstreamRequests = [];

const upstreamA = await startFakeUpstream({
  port: upstreamAPort,
  model: 'expensive-test-model',
  nextDirective: { model: 'B', reason: 'implementation is narrow' }
});
const upstreamB = await startFakeUpstream({
  port: upstreamBPort,
  model: 'cheap-test-model',
  nextDirective: { model: 'C', reason: 'invalid route should be ignored' }
});

await writeFile(configPath, JSON.stringify({
  listen: { host: '127.0.0.1', port: routerPort },
  routerApiKey: routerKey,
  defaultRoute: 'A',
  stateFile: statePath,
  routeInstruction: 'test route instruction',
  upstreams: {
    A: {
      baseUrl: `http://127.0.0.1:${upstreamAPort}/api-prefix`,
      apiKey: 'upstream-a-key',
      model: 'expensive-test-model'
    },
    B: {
      env: {
        ANTHROPIC_BASE_URL: `http://127.0.0.1:${upstreamBPort}/coding`,
        ANTHROPIC_AUTH_TOKEN: 'upstream-b-key',
        ANTHROPIC_MODEL: 'cheap-test-model'
      }
    }
  }
}, null, 2));

const router = spawn(process.execPath, ['src/server.js'], {
  cwd: process.cwd(),
  env: { ...process.env, TINY_ROUTER_CONFIG: configPath },
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

  const first = await sendMessage('first turn');
  assert.equal(first.body.model, 'expensive-test-model');
  assert.equal(first.health.nextRoute, 'B');
  assert.deepEqual(await readState(), {
    nextRoute: 'B',
    reason: 'implementation is narrow'
  });

  const second = await sendMessage('second turn');
  assert.equal(second.body.model, 'cheap-test-model');
  assert.equal(second.health.nextRoute, 'B');
  assert.deepEqual(await readState(), {
    nextRoute: 'B',
    reason: 'implementation is narrow'
  });

  assert.equal(upstreamRequests.length, 2);
  assert.equal(upstreamRequests[0].url, '/api-prefix/v1/messages');
  assert.equal(upstreamRequests[0].headers['x-api-key'], 'upstream-a-key');
  assert.equal(upstreamRequests[0].body.model, 'expensive-test-model');
  assert.match(JSON.stringify(upstreamRequests[0].body.system), /test route instruction/);
  assert.equal(upstreamRequests[1].url, '/coding/v1/messages');
  assert.equal(upstreamRequests[1].headers['x-api-key'], 'upstream-b-key');
  assert.equal(upstreamRequests[1].body.model, 'cheap-test-model');

  console.log('fake upstream integration test passed');
} finally {
  router.kill();
  upstreamA.close();
  upstreamB.close();
}

async function startFakeUpstream({ port, model, nextDirective }) {
  const server = http.createServer(async (req, res) => {
    const body = JSON.parse(await readRequestBody(req));
    upstreamRequests.push({ url: req.url, headers: req.headers, body });

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

async function sendMessage(content) {
  const response = await fetch(`http://127.0.0.1:${routerPort}/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': routerKey },
    body: JSON.stringify({
      model: 'client-requested-model',
      max_tokens: 64,
      messages: [{ role: 'user', content }]
    })
  });

  assert.equal(response.status, 200);
  const body = await response.json();
  const health = await fetch(`http://127.0.0.1:${routerPort}/health`).then((res) => res.json());
  return { body, health };
}

async function readState() {
  const state = JSON.parse(await readFile(statePath, 'utf8'));
  return { nextRoute: state.nextRoute, reason: state.reason };
}
