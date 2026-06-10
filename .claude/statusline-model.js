#!/usr/bin/env node

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  input += chunk;
});
process.stdin.on('end', async () => {
  try {
    const routerBaseUrl = process.env.ANTHROPIC_BASE_URL || '';
    const routerToken = process.env.ANTHROPIC_API_KEY || '';

    if (!routerBaseUrl.includes('127.0.0.1') && !routerBaseUrl.includes('localhost')) {
      process.stdout.write('');
      return;
    }

    const healthUrl = new URL('/health', routerBaseUrl).href;
    const response = await fetch(healthUrl, {
      headers: { 'x-api-key': routerToken }
    });

    if (!response.ok) {
      process.stdout.write('tiny-router: no route');
      return;
    }

    const data = await response.json();
    if (!data.ok) {
      process.stdout.write('tiny-router: no route');
      return;
    }

    const client = data.client || '';
    const route = data.nextRoute || 'unknown';
    const model = data.nextModel || 'unknown model';
    const prefix = client ? `[${client}] ` : '';
    process.stdout.write(`${prefix}next: ${route} -> ${model}`);
  } catch {
    process.stdout.write('');
  }
});
