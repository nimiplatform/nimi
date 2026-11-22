import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { AwsClient } from 'aws4fetch';
import { readNimiAppArchive } from '../../app-tools/lib/app-pack.mjs';
import { validateAppInfo } from '../../app-tools/lib/app-info.mjs';
import { collectStorefrontImageRefs, storefrontMediaExtension } from '../../app-tools/lib/storefront-media.mjs';
import { compareSemverDesc } from './semver.mjs';

export { compareSemverDesc };

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
  'pc_target_versions_json',
  'capabilities',
  'visible',
  'blocked',
  'origin',
  'upstream_json',
  'client_id',
  'source_revision',
  'source_active',
  'policy_commit',
];
const TARGET_BASELINE_ORDER = ['windows-x86_64', 'macos-aarch64'];
const HOSTED_WEB_MAX_ARCHIVE_BYTES = 256 * 1024 * 1024;
const HOSTED_WEB_MAX_UNCOMPRESSED_BYTES = 256 * 1024 * 1024;
const APP_INFO_MAX_BYTES = 1024 * 1024;
const STOREFRONT_MEDIA_MAX_BYTES = 8 * 1024 * 1024;
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

function nativeTargetVersions(row) {
  if (row?.visibility !== 'public' || !row.latest_admitted_release_by_target) return {};
  const out = {};
  for (const targetId of Object.keys(row.latest_admitted_release_by_target).sort()) {
    const descriptorId = row.latest_admitted_release_by_target[targetId]?.descriptor_id;
    const at = typeof descriptorId === 'string' ? descriptorId.lastIndexOf('@') : -1;
    const version = at > 0 ? descriptorId.slice(at + 1) : '';
    if (version) out[targetId] = version;
  }
  return out;
}

export async function reconcilePolicies(root, sha, store, confirmHead = liveHead, { refreshAll = false } = {}) {
  const checkpoint = (await store.query('SELECT revision FROM registry_state WHERE singleton=1')).results[0]
    ?.revision;
  if ((await confirmHead()) !== sha) throw new Error('Registry checkout superseded');
  const index = await readJson(root, 'index.json');
  let ids;
  if (checkpoint) git(root, 'merge-base', '--is-ancestor', checkpoint, sha);
  if (!checkpoint || refreshAll) ids = await dir(root, 'products');
  else {
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
          if (
            JSON.stringify(nativeTargets(prior[id])) !== JSON.stringify(nativeTargets(next[id])) ||
            JSON.stringify(nativeTargetVersions(prior[id])) !== JSON.stringify(nativeTargetVersions(next[id]))
          ) {
            keys.add(id);
          }
        }
        prior = next;
      }
    }
    ids = [...keys];
  }
  for (const id of ids) {
    const { p, web } = await checkoutProduct(root, id);
    const previous = (await store.query('SELECT * FROM products WHERE app_id=?', id)).results[0];
    if (!refreshAll && previous?.policy_commit === sha) continue;
    if (previous) git(root, 'merge-base', '--is-ancestor', previous.policy_commit, sha);
    const targets = nativeTargets(index.apps[id]);
    const targetVersions = nativeTargetVersions(index.apps[id]);
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
      JSON.stringify(targetVersions),
      JSON.stringify(caps),
      Number(p.visibility === 'public'),
      Number(p.kill_switch.active),
      p.origin ?? null,
      p.upstream ? JSON.stringify(p.upstream) : null,
      web?.client_id ?? null,
      web?.source_revision ?? null,
      Number(web?.status === 'active'),
      sha,
    ];
    const newSource = previous && previous.source_revision !== (web?.source_revision ?? null);
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
      // A same-revision migration may run while the asset publisher completes a pending upload.
      ', pending=CASE WHEN products.policy_commit=excluded.policy_commit THEN products.pending ELSE excluded.pending END' +
      ', ready=CASE WHEN ? THEN 0 ELSE products.ready END, active_version=CASE WHEN ? THEN NULL ELSE products.active_version END, active_digest=CASE WHEN ? THEN NULL ELSE products.active_digest END WHERE products.policy_commit=?';
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
    if (!Number.isSafeInteger(release.size) || release.size <= 0 || release.size > HOSTED_WEB_MAX_ARCHIVE_BYTES) {
      throw new Error('Web release archive size exceeds budget');
    }
    const url = p.repository + '/releases/download/web-v' + v + '/nimi-web-' + v + '.zip';
    const bytes = await io.download(url, release.size);
    if (bytes.length !== release.size || createHash('sha256').update(bytes).digest('hex') !== release.sha256)
      throw new Error('Web release digest mismatch');
    const entries = readNimiAppArchive(bytes, {
      maxArchiveBytes: HOSTED_WEB_MAX_ARCHIVE_BYTES,
      maxTotalUncompressedBytes: HOSTED_WEB_MAX_UNCOMPRESSED_BYTES,
    });
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

export async function migrateStorefrontSchema(root, sha, store, confirmHead = liveHead) {
  if ((await confirmHead()) !== sha) throw new Error('Registry checkout superseded');
  const { results } = await store.query('PRAGMA table_info(products)');
  const existingCols = new Set((results || []).map((col) => col.name));
  if (!existingCols.has('origin')) {
    await store.query('ALTER TABLE products ADD COLUMN origin TEXT');
  }
  if (!existingCols.has('upstream_json')) {
    await store.query('ALTER TABLE products ADD COLUMN upstream_json TEXT');
  }
  if (!existingCols.has('pc_target_versions_json')) {
    await store.query("ALTER TABLE products ADD COLUMN pc_target_versions_json TEXT NOT NULL DEFAULT '{}'");
  }
  await store.query(
    'CREATE TABLE IF NOT EXISTS storefront_catalog (app_id TEXT PRIMARY KEY, primary_version TEXT NOT NULL, target_releases_json TEXT NOT NULL, capabilities_json TEXT NOT NULL DEFAULT \'[]\', has_storefront INTEGER NOT NULL DEFAULT 0, category TEXT, default_locale TEXT, summary_en TEXT NOT NULL, summary_zh TEXT NOT NULL, tags_json TEXT NOT NULL DEFAULT \'{}\', icon_asset TEXT, cover_assets_json TEXT, synced_commit TEXT NOT NULL, updated_at INTEGER NOT NULL)',
  );
  const { results: sfCols } = await store.query('PRAGMA table_info(storefront_catalog)');
  const existingSfCols = new Set((sfCols || []).map((col) => col.name));
  if (!existingSfCols.has('capabilities_json')) {
    await store.query('ALTER TABLE storefront_catalog ADD COLUMN capabilities_json TEXT NOT NULL DEFAULT \'[]\'');
  }
  await reconcilePolicies(root, sha, store, confirmHead, { refreshAll: true });
}

function targetBaselineRank(targetId) {
  const idx = TARGET_BASELINE_ORDER.indexOf(targetId);
  return idx === -1 ? TARGET_BASELINE_ORDER.length : idx;
}

function selectBaselineTarget(targets) {
  return [...targets].sort((left, right) => {
    const diff = targetBaselineRank(left.target_id) - targetBaselineRank(right.target_id);
    return diff !== 0 ? diff : left.target_id.localeCompare(right.target_id, 'en');
  })[0];
}

function resolveStorefrontCardSummaries(info, product) {
  if (!info.storefront) {
    return { en: product.summary.en, zh: product.summary.zh };
  }
  const defaultLocale = info.storefront.default_locale;
  const locales = info.storefront.locales || {};
  const forLocale = (locale) => {
    if (defaultLocale === locale) return info.summary;
    return locales[locale]?.summary || info.summary;
  };
  return { en: forLocale('en'), zh: forLocale('zh') };
}

function resolveStorefrontTagsMap(info) {
  if (!info.storefront?.locales) return {};
  const out = {};
  for (const [locale, entry] of Object.entries(info.storefront.locales)) {
    if (Array.isArray(entry.tags) && entry.tags.length > 0) out[locale] = entry.tags;
  }
  return out;
}

function resolveCoverAssetsMap(info) {
  const cover = info.storefront?.media?.cover;
  if (!cover?.default) return null;
  const fileOf = (ref) => `${ref.sha256}.${storefrontMediaExtension(ref.media_type)}`;
  const out = { default: fileOf(cover.default) };
  if (cover.locales && Object.keys(cover.locales).length > 0) {
    out.locales = Object.fromEntries(
      Object.entries(cover.locales).map(([locale, ref]) => [locale, fileOf(ref)]),
    );
  }
  return out;
}

export async function syncStorefronts(
  root,
  sha,
  store,
  io = { head: liveHead, download: fetchBundle },
) {
  if ((await io.head()) !== sha) throw new Error('Registry checkout superseded');
  const index = await readJson(root, 'index.json');
  const appIds = Object.keys(index.apps || {}).sort();
  let syncedApps = 0;
  const failed = [];

  for (const appId of appIds) {
    try {
      const indexRow = index.apps[appId];
      if (indexRow?.visibility !== 'public') continue;
      const { p } = await checkoutProduct(root, appId);
      if (p.visibility !== 'public') continue;

      const existing = (await store.query('SELECT * FROM storefront_catalog WHERE app_id=?', appId)).results[0];
      if (existing?.synced_commit && existing.synced_commit !== sha) {
        git(root, 'merge-base', '--is-ancestor', existing.synced_commit, sha);
      }

      const pointers = Object.entries(indexRow.latest_admitted_release_by_target || {}).sort(([a], [b]) =>
        a.localeCompare(b, 'en'),
      );
      if (pointers.length === 0) continue;

      const descriptorCache = new Map();
      const targetReleases = {};
      const versionsToDescriptors = new Map();

      for (const [targetId, pointer] of pointers) {
        if (!pointer?.path) continue;
        let descriptor = descriptorCache.get(pointer.path);
        if (!descriptor) {
          descriptor = await readJson(root, pointer.path);
          descriptorCache.set(pointer.path, descriptor);
        }
        const candidate = descriptor.candidate;
        const target = candidate.targets.find((t) => t.target_id === targetId);
        if (!target) throw new Error(`Descriptor ${pointer.path} is missing target ${targetId}`);
        targetReleases[targetId] = {
          version: candidate.version,
          size: target.size,
          os: target.os,
          arch: target.arch,
          app_info_sha256: target.app_info.sha256,
          ...(candidate.storefront_media ? { storefront_media_sha256: candidate.storefront_media.sha256 } : {}),
        };
        if (!versionsToDescriptors.has(candidate.version)) {
          versionsToDescriptors.set(candidate.version, { descriptor, targets: [] });
        }
        versionsToDescriptors.get(candidate.version).targets.push(target);
      }

      const activeVersions = [...versionsToDescriptors.keys()].sort(compareSemverDesc);
      if (activeVersions.length === 0) continue;
      const primaryVersion = activeVersions[0];
      const targetReleasesJson = JSON.stringify(targetReleases);

      const existingReleases = existing?.target_releases_json ? JSON.parse(existing.target_releases_json) : {};
      if (existing?.synced_commit === sha && existing.target_releases_json === targetReleasesJson) {
        continue;
      }

      const isVersionAlreadySynced = (version, appInfoSha, mediaSha) =>
        Object.values(existingReleases).some(
          (entry) =>
            entry &&
            entry.version === version &&
            entry.app_info_sha256 === appInfoSha &&
            (entry.storefront_media_sha256 ?? null) === (mediaSha ?? null),
        );

      let primaryCardMeta = null;

      for (const version of activeVersions) {
        const { descriptor, targets } = versionsToDescriptors.get(version);
        const candidate = descriptor.candidate;
        const baseline = selectBaselineTarget(targets);
        const mediaAsset = candidate.storefront_media ?? null;
        const alreadySynced = isVersionAlreadySynced(
          version,
          baseline.app_info.sha256,
          mediaAsset?.sha256 ?? null,
        );

        if (alreadySynced && version !== primaryVersion) {
          continue;
        }
        if (alreadySynced && version === primaryVersion && existing?.primary_version === primaryVersion) {
          primaryCardMeta = {
            capabilitiesJson: existing.capabilities_json ?? '[]',
            hasStorefront: Boolean(existing.has_storefront),
            category: existing.category ?? null,
            defaultLocale: existing.default_locale ?? null,
            summaryEn: existing.summary_en,
            summaryZh: existing.summary_zh,
            tagsJson: existing.tags_json ?? '{}',
            iconAsset: existing.icon_asset ?? null,
            coverAssetsJson: existing.cover_assets_json ?? null,
          };
          continue;
        }

        if (
          !Number.isSafeInteger(baseline.app_info.size) ||
          baseline.app_info.size <= 0 ||
          baseline.app_info.size > APP_INFO_MAX_BYTES
        ) {
          throw new Error(`App info size exceeds budget for ${appId}@${version}`);
        }
        const infoBytes = await io.download(baseline.app_info.asset_url, baseline.app_info.size);
        if (
          infoBytes.length !== baseline.app_info.size ||
          createHash('sha256').update(infoBytes).digest('hex') !== baseline.app_info.sha256
        ) {
          throw new Error(`App info digest mismatch for ${appId}@${version}`);
        }
        const info = validateAppInfo(JSON.parse(infoBytes.toString('utf8')));
        if (info.app_id !== appId || info.version !== version) {
          throw new Error(`App info identity mismatch for ${appId}@${version}`);
        }

        const iconBytes = Buffer.from(info.icon.data_base64, 'base64');
        const iconSha = createHash('sha256').update(iconBytes).digest('hex');
        const iconAsset = `${iconSha}.png`;
        await store.put(`storefront-media/${appId}/${iconAsset}`, iconBytes);

        if (mediaAsset) {
          if (
            !Number.isSafeInteger(mediaAsset.size) ||
            mediaAsset.size <= 0 ||
            mediaAsset.size > STOREFRONT_MEDIA_MAX_BYTES
          ) {
            throw new Error(`Storefront media archive size exceeds budget for ${appId}@${version}`);
          }
          const zipBytes = await io.download(mediaAsset.asset_url, mediaAsset.size);
          if (
            zipBytes.length !== mediaAsset.size ||
            createHash('sha256').update(zipBytes).digest('hex') !== mediaAsset.sha256
          ) {
            throw new Error(`Storefront media archive digest mismatch for ${appId}@${version}`);
          }
          const entries = readNimiAppArchive(zipBytes, {
            maxArchiveBytes: STOREFRONT_MEDIA_MAX_BYTES,
            maxTotalUncompressedBytes: STOREFRONT_MEDIA_MAX_BYTES,
          });
          const expectedFiles = new Set(
            collectStorefrontImageRefs(info.storefront?.media).map(
              (ref) => `${ref.sha256}.${storefrontMediaExtension(ref.media_type)}`,
            ),
          );
          if (entries.size !== expectedFiles.size) {
            throw new Error(`Storefront media archive entry count mismatch for ${appId}@${version}`);
          }
          for (const [name, entry] of entries) {
            if (entry.mode !== 0o644 || !expectedFiles.has(name)) {
              throw new Error(`Unexpected storefront media archive entry ${name} for ${appId}@${version}`);
            }
            const actualSha = createHash('sha256').update(entry.bytes).digest('hex');
            if (!name.startsWith(actualSha + '.')) {
              throw new Error(`Storefront media entry ${name} SHA-256 mismatch for ${appId}@${version}`);
            }
            await store.put(`storefront-media/${appId}/${name}`, entry.bytes);
          }
        }

        const immutableDoc = {
          schema_version: 1,
          app_id: appId,
          version,
          display_name: info.display_name,
          summary: info.summary,
          readme_markdown: info.readme_markdown,
          release_notes_markdown: info.release_notes_markdown || '',
          license: info.license,
          author: info.author || '',
          homepage_url: info.homepage_url || '',
          support_url: info.support_url || '',
          app_access: info.app_access,
          capability_contract_refs: info.capability_contract_refs,
          required_standardized_feature_refs: info.required_standardized_feature_refs,
          storage_policy: info.storage_policy,
          safety_profile: info.safety_profile ?? null,
          admission_trust_tier: descriptor.admission?.trust_tier ?? null,
          icon_asset: iconAsset,
          ...(info.storefront ? { storefront: info.storefront } : {}),
        };
        await store.put(
          `storefront-docs/${appId}/${version}.json`,
          Buffer.from(JSON.stringify(immutableDoc), 'utf8'),
        );

        if (version === primaryVersion) {
          const summaries = resolveStorefrontCardSummaries(info, p);
          const coverAssets = resolveCoverAssetsMap(info);
          primaryCardMeta = {
            capabilitiesJson: JSON.stringify(info.capability_contract_refs || []),
            hasStorefront: Boolean(info.storefront),
            category: info.storefront?.category ?? null,
            defaultLocale: info.storefront?.default_locale ?? null,
            summaryEn: summaries.en,
            summaryZh: summaries.zh,
            tagsJson: JSON.stringify(resolveStorefrontTagsMap(info)),
            iconAsset,
            coverAssetsJson: coverAssets ? JSON.stringify(coverAssets) : null,
          };
        }
      }

      if (!primaryCardMeta) continue;
      if ((await io.head()) !== sha) throw new Error('Registry checkout superseded during storefront sync');

      const now = Date.now();
      const result = await store.query(
        'INSERT INTO storefront_catalog(app_id,primary_version,target_releases_json,capabilities_json,has_storefront,category,default_locale,summary_en,summary_zh,tags_json,icon_asset,cover_assets_json,synced_commit,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(app_id) DO UPDATE SET primary_version=excluded.primary_version,target_releases_json=excluded.target_releases_json,capabilities_json=excluded.capabilities_json,has_storefront=excluded.has_storefront,category=excluded.category,default_locale=excluded.default_locale,summary_en=excluded.summary_en,summary_zh=excluded.summary_zh,tags_json=excluded.tags_json,icon_asset=excluded.icon_asset,cover_assets_json=excluded.cover_assets_json,synced_commit=excluded.synced_commit,updated_at=excluded.updated_at WHERE storefront_catalog.synced_commit IS ?',
        appId,
        primaryVersion,
        targetReleasesJson,
        primaryCardMeta.capabilitiesJson,
        Number(primaryCardMeta.hasStorefront),
        primaryCardMeta.category,
        primaryCardMeta.defaultLocale,
        primaryCardMeta.summaryEn,
        primaryCardMeta.summaryZh,
        primaryCardMeta.tagsJson,
        primaryCardMeta.iconAsset,
        primaryCardMeta.coverAssetsJson,
        sha,
        now,
        existing?.synced_commit ?? null,
      );
      if (result.meta?.changes === 0) throw new Error('Concurrent storefront_catalog update for ' + appId);
      syncedApps += 1;
    } catch (error) {
      failed.push(`${appId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (failed.length > 0) {
    throw new Error(`Storefront sync failed for ${failed.length} app(s): ${failed.join('; ')}`);
  }
  return { syncedApps };
}

async function main() {
  const [mode, target] = process.argv.slice(2);
  if (!['migrate', 'policy', 'publish', 'storefront'].includes(mode))
    throw new Error('Expected migrate|policy|publish|storefront and a trusted Registry checkout');
  const store = cloudflareStore(process.env);
  if (!target) throw new Error('Expected a trusted Registry checkout');
  const root = path.resolve(target),
    sha = git(root, 'rev-parse', 'HEAD');
  if (mode === 'migrate') return migrateStorefrontSchema(root, sha, store);
  if (mode === 'policy') return reconcilePolicies(root, sha, store);
  if (mode === 'storefront') return syncStorefronts(root, sha, store);
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
