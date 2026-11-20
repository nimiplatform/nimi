import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { AwsClient } from 'aws4fetch';
import { readNimiAppArchive } from '../../app-tools/lib/app-pack.mjs';

const repository = 'nimiplatform/nimi-app-registry';
const columns = [
  'slug',
  'app_id',
  'display_name',
  'publisher',
  'repository',
  'license',
  'summary_en',
  'summary_zh',
  'pc_targets',
  'capabilities',
  'visible',
  'blocked',
  'client_id',
  'source_revision',
  'source_active',
  'policy_commit',
];
const git = (root, ...args) =>
  execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', windowsHide: true, maxBuffer: 128 * 1024 * 1024 }).trim();
function required(env, name) {
  if (!env[name]) throw new Error('Missing ' + name);
  return env[name];
}
const readJson = async (root, file) => JSON.parse(await readFile(path.join(root, file), 'utf8'));
async function dir(root, name) {
  try {
    return await readdir(path.join(root, name));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

export function cloudflareStore(env) {
  const account = required(env, 'CLOUDFLARE_ACCOUNT_ID'),
    database = required(env, 'CLOUDFLARE_HOSTED_WEB_DATABASE_ID');
  const bucket = required(env, 'CLOUDFLARE_HOSTED_WEB_BUCKET'),
    token = required(env, 'CLOUDFLARE_HOSTED_WEB_API_TOKEN');
  const base = 'https://api.cloudflare.com/client/v4/accounts/' + encodeURIComponent(account);
  let r2Signer;
  async function request(url, init) {
    const response = await fetch(url, {
      ...init,
      redirect: 'error',
      headers: { ...init.headers, Authorization: 'Bearer ' + token },
    });
    if (!response.ok) throw new Error('Cloudflare request failed: HTTP ' + response.status);
    const envelope = await response.json();
    if (envelope.success !== true)
      throw new Error('Cloudflare rejected the operation: ' + JSON.stringify(envelope.errors));
    return envelope.result;
  }
  return {
    async query(statement, ...values) {
      // The D1 HTTP API takes string parameters; represent null as SQL NULL in our own fixed statements.
      const params = [];
      let index = 0;
      const sql = statement.replace(/\?/g, () => {
        const value = values[index++];
        if (value === null) return 'NULL';
        params.push(String(value));
        return '?';
      });
      if (index !== values.length) throw new Error('Incorrect D1 argument count');
      const result = await request(base + '/d1/database/' + encodeURIComponent(database) + '/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql, params }),
      });
      if (!result[0]?.success) throw new Error('D1 statement failed');
      return result[0];
    },
    async put(key, bytes) {
      if (!r2Signer) {
        const identity = await request(base + '/tokens/verify', { method: 'GET' });
        if (!identity?.id || identity.status !== 'active') throw new Error('Inactive R2 publisher token');
        r2Signer = new AwsClient({
          accessKeyId: identity.id,
          secretAccessKey: createHash('sha256').update(token).digest('hex'),
          region: 'auto',
          service: 's3',
        });
      }
      const objectPath = [bucket, ...key.split('/')].map(encodeURIComponent).join('/');
      const signed = await r2Signer.sign('https://' + account + '.r2.cloudflarestorage.com/' + objectPath, {
        method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: bytes,
      });
      const response = await fetch(signed, { redirect: 'error' });
      await response.body?.cancel();
      if (!response.ok) throw new Error('R2 S3 upload failed: HTTP ' + response.status);
    },
  };
}

async function checkoutProduct(root, appId) {
  const stem = 'products/' + appId;
  const p = await readJson(root, stem + '/product.json');
  if (p.app_id !== appId || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(p.slug))
    throw new Error('Unexpected Registry product');
  const sources = await Promise.all(
    (await dir(root, stem + '/sources')).map((f) => readJson(root, stem + '/sources/' + f)),
  );
  return { p, web: sources.find((s) => s.kind === 'hosted-web'), stem };
}

async function liveHead() {
  const result = await fetch('https://api.github.com/repos/' + repository + '/commits/main', {
    headers: {
      Accept: 'application/vnd.github.sha',
      ...(process.env.GITHUB_TOKEN ? { Authorization: 'Bearer ' + process.env.GITHUB_TOKEN } : {}),
    },
    redirect: 'error',
  });
  if (!result.ok) throw new Error('Could not confirm Registry main: HTTP ' + result.status);
  return (await result.text()).trim();
}

function nativeTargets(row) {
  return row?.visibility === 'public' ? Object.keys(row.latest_admitted_release_by_target).sort() : [];
}

export async function reconcilePolicies(root, sha, store, confirmHead = liveHead) {
  const checkpoint = (await store.query('SELECT revision FROM registry_state WHERE singleton=1')).results[0]
    ?.revision;
  if ((await confirmHead()) !== sha) throw new Error('Registry checkout superseded');
  const index = await readJson(root, 'index.json');
  let ids;
  if (!checkpoint) ids = await dir(root, 'products');
  else {
    git(root, 'merge-base', '--is-ancestor', checkpoint, sha);
    // Include intermediate changes that were reverted after a partially applied sync.
    const changes = git(
      root,
      'log',
      '--format=',
      '--name-only',
      checkpoint + '..' + sha,
      '--',
      'products',
      'index.json',
    ).split('\n');
    const keys = new Set(changes.filter((p) => p.startsWith('products/')).map((p) => p.split('/')[1]));
    if (changes.includes('index.json')) {
      // A native version bump does not change the public target list. Include intermediate
      // target changes so a partially applied reconciliation can be repaired after a revert.
      let prior = JSON.parse(git(root, 'show', checkpoint + ':index.json')).apps;
      const revisions = git(root, 'log', '--first-parent', '--reverse', '--format=%H', checkpoint + '..' + sha, '--', 'index.json');
      for (const revision of revisions.split('\n').filter(Boolean)) {
        const next = revision === sha ? index.apps : JSON.parse(git(root, 'show', revision + ':index.json')).apps;
        for (const id of new Set([...Object.keys(prior), ...Object.keys(next)])) {
          if (JSON.stringify(nativeTargets(prior[id])) !== JSON.stringify(nativeTargets(next[id]))) keys.add(id);
        }
        prior = next;
      }
    }
    ids = [...keys];
  }
  for (const id of ids) {
    const { p, web } = await checkoutProduct(root, id);
    const previous = (await store.query('SELECT * FROM products WHERE app_id=?', id)).results[0];
    if (previous?.policy_commit === sha) continue;
    if (previous) git(root, 'merge-base', '--is-ancestor', previous.policy_commit, sha);
    const targets = nativeTargets(index.apps[id]);
    const caps = web?.capability_contract_refs ?? [];
    const values = [
      p.slug,
      id,
      p.display_name,
      p.publisher,
      p.repository,
      p.license,
      p.summary.en,
      p.summary.zh,
      JSON.stringify(targets),
      JSON.stringify(caps),
      Number(p.visibility === 'public'),
      Number(p.kill_switch.active),
      web?.client_id ?? null,
      web?.source_revision ?? null,
      Number(web?.status === 'active'),
      sha,
    ];
    const newSource = previous && previous.source_revision !== web?.source_revision;
    const update = columns
      .filter((c) => !['app_id', 'slug'].includes(c))
      .map((c) => c + '=excluded.' + c)
      .join(',');
    const stmt =
      'INSERT INTO products(' +
      columns.join(',') +
      ',pending) VALUES(' +
      values.map(() => '?').join(',') +
      ',?) ON CONFLICT(app_id) DO UPDATE SET ' +
      update +
      ', pending=excluded.pending, ready=CASE WHEN ? THEN 0 ELSE products.ready END, active_version=CASE WHEN ? THEN NULL ELSE products.active_version END, active_digest=CASE WHEN ? THEN NULL ELSE products.active_digest END WHERE products.policy_commit=?';
    const pending = Number(
      Boolean(
        web?.stable_version &&
        web.status === 'active' &&
        !p.kill_switch.active &&
        (previous?.active_version !== web.stable_version ||
          newSource ||
          !previous?.ready ||
          previous.pending),
      ),
    );
    const result = await store.query(
      stmt,
      ...values,
      pending,
      Number(Boolean(newSource)),
      Number(Boolean(newSource)),
      Number(Boolean(newSource)),
      previous?.policy_commit ?? null,
    );
    if (result.meta.changes === 0) throw new Error('Concurrent policy change for ' + id);
  }
  if ((await confirmHead()) !== sha) throw new Error('Registry changed during policy synchronization');
  const done = await store.query(
    'INSERT INTO registry_state(singleton,revision,checked_at) VALUES(1,?,?) ON CONFLICT(singleton) DO UPDATE SET revision=excluded.revision,checked_at=excluded.checked_at WHERE registry_state.revision=?',
    sha,
    Date.now(),
    checkpoint ?? null,
  );
  if (done.meta.changes === 0) throw new Error('Concurrent checkpoint update');
}

async function fetchBundle(url, size) {
  const r = await fetch(url);
  if (!r.ok || !r.body) throw new Error('Unable to download approved artifact: HTTP ' + r.status);
  const chunks = [];
  let length = 0;
  for await (const part of r.body) {
    length += part.length;
    if (length > size) throw new Error('Release exceeded declared length');
    chunks.push(part);
  }
  if (length !== size) throw new Error('Incomplete approved archive');
  return Buffer.concat(chunks, length);
}

export async function publishProduct(
  root,
  sha,
  store,
  row,
  io = { head: liveHead, download: fetchBundle, probe: fetch },
) {
  const { p, web, stem } = await checkoutProduct(root, row.app_id);
  if (
    !web ||
    p.kill_switch.active ||
    web.status !== 'active' ||
    row.blocked ||
    !row.source_active ||
    row.source_revision !== web.source_revision
  )
    throw new Error('Source is not eligible');
  const release = await readJson(root, stem + '/web/releases/' + web.stable_version + '.json');
  const v = release.version;
  if (
    v !== web.stable_version ||
    release.client_id !== web.client_id ||
    release.source_revision !== web.source_revision
  )
    throw new Error('Incompatible selected release');
  if ((await io.head()) !== sha) throw new Error('Superseded production selection');
  const history = (await store.query('SELECT * FROM releases WHERE app_id=? AND version=?', row.app_id, v))
    .results[0];
  if (history && (history.digest !== release.sha256 || history.source_revision !== release.source_revision))
    throw new Error('Retained release differs from approved descriptor');
  if (!history) {
    const url = p.repository + '/releases/download/web-v' + v + '/nimi-web-' + v + '.zip';
    const bytes = await io.download(url, release.size);
    if (bytes.length !== release.size || createHash('sha256').update(bytes).digest('hex') !== release.sha256)
      throw new Error('Web release digest mismatch');
    const entries = readNimiAppArchive(bytes);
    const info = JSON.parse(entries.get('nimi-web-bundle.json')?.bytes.toString('utf8') ?? 'null');
    if (
      info?.app_id !== row.app_id ||
      info.client_id !== web.client_id ||
      info.version !== v ||
      !entries.has('index.html')
    )
      throw new Error('Incorrect approved archive');
    for (const [name, entry] of entries) {
      if (entry.mode !== 0o644) throw new Error('Web asset must be a regular file');
      await store.put(row.app_id + '/' + release.sha256 + '/' + name, entry.bytes);
    }
  }
  if ((await io.head()) !== sha) throw new Error('Superseded Web publication');
  const change = await store.query(
    'UPDATE products SET active_version=?,active_digest=? WHERE app_id=? AND policy_commit=? AND source_revision=? AND source_active=1 AND blocked=0 AND active_version IS ? AND pending=1 AND (SELECT revision FROM registry_state WHERE singleton=1)=?',
    v,
    release.sha256,
    row.app_id,
    row.policy_commit,
    web.source_revision,
    row.active_version,
    sha,
  );
  if (!change.meta.changes) throw new Error('Web selection changed before activation');
  if (!row.ready) {
    const lookup = await io.probe(
      'https://realm.nimi.ai/api/auth/runtime-clients/' + encodeURIComponent(web.client_id),
      { redirect: 'error', cache: 'no-store' },
    );
    if (!lookup.ok) throw new Error('Realm does not recognize the production source');
    const admitted = await lookup.json();
    if (
      admitted.clientId !== web.client_id ||
      admitted.appId !== p.app_id ||
      admitted.role !== 'app' ||
      admitted.sourceRevision !== web.source_revision ||
      admitted.origin !== 'https://' + p.slug + '.nimi.xyz' ||
      admitted.redirectUri !== admitted.origin + '/'
    )
      throw new Error('Realm source revision mismatch');
  }
  const actual = await io.probe('https://' + p.slug + '.nimi.xyz/', {
    method: 'HEAD',
    redirect: 'error',
    cache: 'no-store',
  });
  if (
    !actual.ok ||
    actual.headers.get('X-Nimi-Web-Digest') !== release.sha256 ||
    actual.headers.get('X-Nimi-Web-Version') !== v
  )
    throw new Error('Published host has not verified the selected version');
  const marked = await store.query(
    'UPDATE products SET ready=1,pending=0 WHERE app_id=? AND policy_commit=? AND active_version=? AND active_digest=? AND blocked=0 AND source_active=1',
    row.app_id,
    row.policy_commit,
    v,
    release.sha256,
  );
  if (!marked.meta.changes) throw new Error('Policy changed during public verification');
}

async function main() {
  const [mode, target] = process.argv.slice(2);
  if (!target || !['policy', 'publish'].includes(mode))
    throw new Error('Expected policy|publish and a trusted Registry checkout');
  const root = path.resolve(target),
    sha = git(root, 'rev-parse', 'HEAD');
  const store = cloudflareStore(process.env);
  if (mode === 'policy') return reconcilePolicies(root, sha, store);
  let after = '',
    failed = false;
  for (;;) {
    const { results } = await store.query(
      'SELECT * FROM products WHERE pending=1 AND blocked=0 AND source_active=1 AND app_id>? ORDER BY app_id LIMIT 50',
      after,
    );
    for (const row of results) {
      try {
        await publishProduct(root, sha, store, row);
      } catch (error) {
        failed = true;
        console.error(row.app_id, error.message);
      }
    }
    if (results.length < 50) break;
    after = results.at(-1).app_id;
  }
  if (failed) throw new Error('One or more Web publications failed. See the affected products above.');
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
