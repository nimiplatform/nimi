import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const project = 'nimi';
const [command, value, dist = 'apps/web/dist'] = process.argv.slice(2);

async function cloudflare(endpoint, method = 'GET') {
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  assert.match(account || '', /^[a-f0-9]{32}$/u, 'Cloudflare account ID is required');
  assert.ok(token, 'Cloudflare API token is required');
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/pages/projects/${project}${endpoint}`, {
    method, headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000),
  });
  const body = await response.json();
  if (!response.ok || body.success !== true) {
    throw new Error(`Cloudflare ${method} ${endpoint}: ${response.status} ${JSON.stringify(body.errors)}`);
  }
  return body.result;
}

async function verify(origin, directory) {
  const base = new URL(origin);
  assert.equal(base.protocol, 'https:');
  assert.ok(['nimi.ai', 'nimi-6jb.pages.dev'].includes(base.hostname)
    || /^[a-z0-9-]+\.nimi-6jb\.pages\.dev$/u.test(base.hostname));
  const local = await readFile(path.join(directory, 'index.html'), 'utf8');
  const entry = local.match(/<script\b[^>]*src="(\/assets\/main-[^"]+\.js)"/u)?.[1];
  assert.ok(entry, 'Vite main entry is missing');
  const publicPaths = ['/', '/download', '/terms', '/privacy', '/apps/zhiyu'];
  const accountPaths = ['/login', '/register', '/account/recovery', '/account/runtime'];
  const paths = [...publicPaths, ...accountPaths];
  for (const pathname of paths) {
    const response = await fetch(new URL(pathname, base), { redirect: 'manual', signal: AbortSignal.timeout(30_000) });
    assert.equal(response.status, 200, `${pathname}: HTTP ${response.status}`);
    assert.match(response.headers.get('content-type') || '', /text\/html/u);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('x-frame-options'), 'DENY');
    assert.equal(response.headers.get('set-cookie'), null, 'Static hosting must not set account cookies');
    const html = await response.text();
    if (!['/download', '/terms', '/privacy'].includes(pathname)) assert.ok(html.includes(entry), `${pathname}: different build`);
    if (pathname.startsWith('/account') || ['/login', '/register'].includes(pathname)) {
      assert.equal(response.headers.get('cache-control'), 'no-store');
    }
    if (base.hostname.endsWith('.pages.dev')) {
      assert.match(response.headers.get('content-security-policy') || '', /connect-src 'self'/u);
    }
  }
  const asset = await fetch(new URL(entry, base), { redirect: 'manual', signal: AbortSignal.timeout(30_000) });
  assert.equal(asset.status, 200);
  assert.match(asset.headers.get('content-type') || '', /javascript/u);
  assert.match(asset.headers.get('cache-control') || '', /immutable/u);
  if (base.hostname === 'nimi.ai') {
    for (const host of ['www.nimi.ai', 'web.nimi.ai']) {
      const pathname = '/account/runtime?lang=zh';
      const redirect = await fetch(`https://${host}${pathname}`, { redirect: 'manual', signal: AbortSignal.timeout(30_000) });
      assert.equal(redirect.status, 308);
      assert.equal(redirect.headers.get('location'), `${base.origin}${pathname}`);
    }
  }
  console.log(`Verified ${base.origin}: ${paths.length} HTML routes and ${entry}`);
}

if (command === 'verify') {
  await verify(value, dist);
} else if (command === 'deployment') {
  const records = (await readFile(value, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
  const deployed = records.findLast((record) => record.type === 'pages-deploy-detailed');
  assert.equal(deployed?.pages_project, project);
  const remote = await cloudflare(`/deployments/${deployed.deployment_id}`);
  assert.equal(remote.latest_stage?.status, 'success', 'Deployment is not confirmed successful');
  assert.equal(remote.url, deployed.url);
  await verify(remote.url, dist);
  console.log(`Deployment ${remote.id}; source ${remote.deployment_trigger.metadata.commit_hash}; ${remote.environment}`);
} else if (command === 'rollback') {
  assert.match(value || '', /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/u, 'Exact deployment UUID is required');
  const target = await cloudflare(`/deployments/${value}`);
  assert.equal(target.environment, 'production', 'Preview is not a rollback target');
  assert.equal(target.latest_stage?.status, 'success', 'Rollback target must have deployed successfully');
  const current = await cloudflare('');
  console.log(`Rolling back ${current.canonical_deployment.id} to ${target.id}; source ${target.deployment_trigger.metadata.commit_hash}`);
  await cloudflare(`/deployments/${value}/rollback`, 'POST');
  const after = await cloudflare('');
  assert.equal(after.canonical_deployment.id, value);
  console.log(`Production now serves deployment ${value}`);
} else {
  throw new Error('Usage: cloudflare-release.mjs verify <https-origin> [dist] | deployment <wrangler-output-jsonl> [dist] | rollback <deployment-uuid>');
}
