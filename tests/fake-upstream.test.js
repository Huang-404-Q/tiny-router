import http from 'node:http';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';

const routerPort = 4567;
const upstreamControlPort = 4568;
const upstreamExecutionPort = 4569;
const routerKey = 'test-router-key';
const tempDir = await mkdtemp(join(tmpdir(), 'tiny-router-test-'));
const configPath = join(tempDir, 'router.config.json');
const statePath = join(tempDir, 'router-state.json');
const upstreamRequests = [];

const upstreamControl = await startFakeUpstream({
  port: upstreamControlPort,
  model: 'expensive-test-model',
  nextDirective: { route: 'execution', reason: 'implementation is narrow' },
  streamDirective: { route: 'control', reason: 'review needs stronger model' }
});
const upstreamExecution = await startFakeUpstream({
  port: upstreamExecutionPort,
  model: 'cheap-test-model',
  nextDirective: { route: 'unknown', reason: 'invalid route should be ignored' },
  streamDirective: { route: 'control', reason: 'review needs stronger model' }
});

await writeFile(configPath, JSON.stringify({
  listen: { host: '127.0.0.1', port: routerPort },
  routerApiKey: routerKey,
  defaultRoute: 'control',
  stateFile: statePath,
  routeInstruction: 'test route instruction',
  upstreams: {
    control: {
      baseUrl: `http://127.0.0.1:${upstreamControlPort}/api-prefix`,
      apiKey: 'upstream-control-key',
      model: 'expensive-test-model'
    },
    execution: {
      env: {
        ANTHROPIC_BASE_URL: `http://127.0.0.1:${upstreamExecutionPort}/coding`,
        ANTHROPIC_AUTH_TOKEN: 'upstream-execution-key',
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
  assert.equal(first.health.nextRoute, 'execution');
  assert.equal(first.health.reason, 'implementation is narrow');
  assert.deepEqual(await readState(), {
    nextRoute: 'execution',
    reason: 'implementation is narrow'
  });

  const second = await sendMessage('second turn');
  assert.equal(second.body.model, 'cheap-test-model');
  assert.equal(second.health.nextRoute, 'execution');
  assert.equal(second.health.reason, 'implementation is narrow');
  assert.deepEqual(await readState(), {
    nextRoute: 'execution',
    reason: 'implementation is narrow'
  });

  const streamed = await sendMessage('streaming turn', { stream: true });
  assert.match(streamed.text, /stream from cheap-test-model/);
  assert.equal(streamed.health.nextRoute, 'control');
  assert.equal(streamed.health.reason, 'review needs stronger model');
  assert.deepEqual(await readState(), {
    nextRoute: 'control',
    reason: 'review needs stronger model'
  });

  assert.equal(upstreamRequests.length, 3);
  assert.equal(upstreamRequests[0].url, '/api-prefix/v1/messages');
  assert.equal(upstreamRequests[0].headers['x-api-key'], 'upstream-control-key');
  assert.equal(upstreamRequests[0].body.model, 'expensive-test-model');
  assert.match(JSON.stringify(upstreamRequests[0].body.system), /test route instruction/);
  assert.equal(upstreamRequests[1].url, '/coding/v1/messages');
  assert.equal(upstreamRequests[1].headers['x-api-key'], 'upstream-execution-key');
  assert.equal(upstreamRequests[1].body.model, 'cheap-test-model');
  assert.equal(upstreamRequests[2].url, '/coding/v1/messages');
  assert.equal(upstreamRequests[2].body.model, 'cheap-test-model');

  console.log('fake upstream integration test passed');
} finally {
  router.kill();
  upstreamControl.close();
  upstreamExecution.close();
}

async function startFakeUpstream({ port, model, nextDirective, streamDirective }) {
  const server = http.createServer(async (req, res) => {
    const body = JSON.parse(await readRequestBody(req));
    upstreamRequests.push({ url: req.url, headers: req.headers, body });

    if (body.stream === true) {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      writeSseText(res, `stream from ${model}\n`);
      writeSseText(res, `${JSON.stringify(streamDirective || nextDirective)}`);
      res.end('data: [DONE]\n\n');
      return;
    }

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

function writeSseText(res, text) {
  res.write(`data: ${JSON.stringify({
    type: 'content_block_delta',
    delta: { type: 'text_delta', text }
  })}\n\n`);
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

async function sendMessage(content, options = {}) {
  const response = await fetch(`http://127.0.0.1:${routerPort}/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': routerKey },
    body: JSON.stringify({
      model: 'client-requested-model',
      max_tokens: 64,
      stream: options.stream === true,
      messages: [{ role: 'user', content }]
    })
  });

  assert.equal(response.status, 200);
  if (options.stream === true) {
    const text = await response.text();
    const health = await fetch(`http://127.0.0.1:${routerPort}/health`).then((res) => res.json());
    return { text, health };
  }

  const body = await response.json();
  const health = await fetch(`http://127.0.0.1:${routerPort}/health`).then((res) => res.json());
  return { body, health };
}

async function readState() {
  const state = JSON.parse(await readFile(statePath, 'utf8'));
  return { nextRoute: state.nextRoute, reason: state.reason };
}
