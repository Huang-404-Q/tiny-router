#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { configPath, claudeArgs } = parseArgs(process.argv.slice(2));

if (!existsSync(configPath)) {
  console.error(`Missing config file: ${configPath}`);
  console.error('Run this command from a tiny-router project directory, or pass a config path.');
  process.exit(1);
}

const config = JSON.parse(await readFile(configPath, 'utf8'));
const port = config.listen?.port || 3456;
const host = config.listen?.host || '127.0.0.1';
const routerApiKey = config.routerApiKey || 'dev-router-key';
const baseUrl = `http://${host}:${port}`;

if (!(await isHealthy(baseUrl))) {
  console.log(`Starting tiny-router on ${baseUrl}`);
  const router = spawn(process.execPath, [resolve(packageRoot, 'src/server.js')], {
    cwd: dirname(configPath),
    env: { ...process.env, TINY_ROUTER_CONFIG: configPath },
    detached: true,
    stdio: process.platform === 'win32' ? 'ignore' : ['ignore', 'ignore', 'ignore']
  });
  router.unref();

  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (await isHealthy(baseUrl)) break;
    await delay(300);
  }

  if (!(await isHealthy(baseUrl))) {
    console.error(`tiny-router did not become healthy on ${baseUrl}`);
    process.exit(1);
  }
} else {
  console.log(`tiny-router is already running on ${baseUrl}`);
}

const env = { ...process.env };
delete env.ANTHROPIC_AUTH_TOKEN;
env.ANTHROPIC_BASE_URL = baseUrl;
env.ANTHROPIC_API_KEY = routerApiKey;

console.log('Launching Claude Code through tiny-router...');
console.log(`ANTHROPIC_BASE_URL=${env.ANTHROPIC_BASE_URL}`);

const claude = spawn('claude', claudeArgs, {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env
});

claude.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});

function parseArgs(args) {
  const claudeArgs = [];
  let configPath = resolve('router.config.json');

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--config' || arg === '-c') {
      const value = args[++index];
      if (!value) {
        console.error(`${arg} requires a config path.`);
        process.exit(1);
      }
      configPath = resolve(value);
    } else {
      claudeArgs.push(arg);
    }
  }

  return { configPath, claudeArgs };
}

async function isHealthy(url) {
  try {
    const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(1000) });
    return response.ok;
  } catch {
    return false;
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
