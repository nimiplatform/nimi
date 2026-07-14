import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
const avatarAssetRef = 'vrm_aaaaaaaaaaaa';
const backgroundAssetRef = 'bg_bbbbbbbbbbbb';

export async function withFixtureRuntimeLocalAgent(run) {
  const handoffPath = process.env.NIMI_LOCAL_AGENT_PRODUCT_HANDOFF_PATH?.trim();
  assert.ok(
    handoffPath,
    'Zhiyu real local-app acceptance requires the shared Desktop-to-Zhiyu product runner handoff',
  );
  const handoff = JSON.parse(await readFile(handoffPath, 'utf8'));
  assert.equal(handoff.schemaVersion, 'nimi.local-agent-product-desktop-handoff/v2');
  for (const field of [
    'runtimeEndpoint',
    'realmBaseUrl',
    'standardDataRoot',
    'ownerUserId',
    'runtimeSourceRef',
    'localAgentRef',
  ]) {
    assert.equal(
      typeof handoff[field] === 'string' && handoff[field].trim().length > 0,
      true,
      `Desktop-to-Zhiyu handoff requires ${field}`,
    );
  }
  const admittedAgent = Array.isArray(handoff.agents)
    ? handoff.agents.find((candidate) => candidate?.localAgentRef === handoff.localAgentRef)
    : null;
  const targetAgent = {
    ...(admittedAgent ?? {}),
    ownerUserId: handoff.ownerUserId,
    runtimeSourceRef: handoff.runtimeSourceRef,
    localAgentRef: handoff.localAgentRef,
    sourceKind: admittedAgent?.sourceKind ?? handoff.sourceKind,
    sourceRef: admittedAgent?.sourceRef ?? handoff.sourceRef,
    displayName: admittedAgent?.displayName ?? handoff.displayName,
  };
  assert.equal(targetAgent.localAgentRef, handoff.localAgentRef);
  assert.equal(targetAgent.runtimeSourceRef, handoff.runtimeSourceRef);
  await run({
    endpoint: handoff.runtimeEndpoint,
    realmBaseUrl: handoff.realmBaseUrl,
    targetAgent,
    standardDataRoot: handoff.standardDataRoot,
    handoff,
  });
}

export async function seedStandardShellAppearanceAssets(input) {
  const agentCenterRoot = path.join(
    input.dataRoot,
    'agent-center',
    'accounts',
    segment(input.ownerUserId),
    'agents',
    segment(input.localAgentRef),
    'agent-center',
  );
  const avatarDir = path.join(agentCenterRoot, 'modules', 'avatar_asset', 'packages', 'vrm', avatarAssetRef);
  const avatarFilesDir = path.join(avatarDir, 'files');
  const avatarBytes = validVrmGlb();
  const avatarFiles = [{
    path: 'files/fixture.vrm',
    sha256: sha256(avatarBytes),
    bytes: avatarBytes.byteLength,
    mime: 'model/vrm',
  }];
  const avatarPackageDigest = avatarContentDigest(avatarFiles);
  await mkdir(avatarFilesDir, { recursive: true });
  await writeFile(path.join(avatarFilesDir, 'fixture.vrm'), avatarBytes);
  await writeFile(path.join(avatarDir, 'manifest.json'), `${JSON.stringify({
    manifest_version: 1,
    asset_version: '1.0.0',
    local_asset_id: avatarAssetRef,
    kind: 'vrm',
    loader_min_version: '1.0.0',
    display_name: 'Zhiyu real local agent fixture',
    display_name_i18n: {},
    entry_file: 'files/fixture.vrm',
    required_files: ['files/fixture.vrm'],
    content_digest: `sha256:${avatarPackageDigest}`,
    files: avatarFiles,
    limits: { max_manifest_bytes: 262_144, max_asset_bytes: 524_288_000, max_file_bytes: 104_857_600, max_file_count: 2_048 },
    capabilities: {
      backend_kind: 'vrm',
      profile_ref: `avatar.backend_profile:vrm:${avatarAssetRef}:import_validated`,
      materialization_ref: `agent-center-avatar-asset:${segment(input.ownerUserId)}:${segment(input.localAgentRef)}:vrm:${avatarAssetRef}`,
    },
    import: {
      imported_at: '1970-01-01T00:00:00.000Z',
      source_label: 'zhiyu-real-local-agent-fixture.vrm',
      source_fingerprint: `sha256:${avatarPackageDigest}`,
    },
  }, null, 2)}\n`);

  const backgroundDir = path.join(agentCenterRoot, 'modules', 'appearance', 'backgrounds', backgroundAssetRef);
  const backgroundBytes = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/l0G3WQAAAABJRU5ErkJggg==',
    'base64',
  );
  await mkdir(backgroundDir, { recursive: true });
  await writeFile(path.join(backgroundDir, 'image.png'), backgroundBytes);
  await writeFile(path.join(backgroundDir, 'manifest.json'), `${JSON.stringify({
    manifest_version: 1,
    background_asset_id: backgroundAssetRef,
    display_name: 'Zhiyu real local agent fixture',
    image_file: 'image.png',
    mime: 'image/png',
    bytes: backgroundBytes.byteLength,
    pixel_width: 1,
    pixel_height: 1,
    limits: { max_bytes: 20_971_520, max_pixel_width: 8_192, max_pixel_height: 8_192 },
    sha256: sha256(backgroundBytes),
    imported_at: '1970-01-01T00:00:00.000Z',
    source_label: 'zhiyu-real-local-agent-fixture.png',
  }, null, 2)}\n`);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function avatarContentDigest(files) {
  const hash = createHash('sha256');
  for (const file of [...files].sort((left, right) => left.path.localeCompare(right.path))) {
    hash.update(file.path);
    hash.update('\0');
    hash.update(String(file.bytes));
    hash.update('\0');
    hash.update(file.sha256);
    hash.update('\n');
  }
  return hash.digest('hex');
}

function validVrmGlb() {
  const root = {
    asset: { version: '2.0' },
    extensionsUsed: ['VRMC_vrm'],
    extensions: { VRMC_vrm: { specVersion: '1.0' } },
  };
  const json = Buffer.from(JSON.stringify(root), 'utf8');
  const padding = (4 - (json.byteLength % 4)) % 4;
  const jsonChunk = padding === 0 ? json : Buffer.concat([json, Buffer.alloc(padding, 0x20)]);
  const glb = Buffer.alloc(20 + jsonChunk.byteLength);
  glb.write('glTF', 0, 'ascii');
  glb.writeUInt32LE(2, 4);
  glb.writeUInt32LE(glb.byteLength, 8);
  glb.writeUInt32LE(jsonChunk.byteLength, 12);
  glb.writeUInt32LE(0x4e4f534a, 16);
  jsonChunk.copy(glb, 20);
  return glb;
}

function segment(value) {
  const text = String(value || '');
  const body = text.startsWith('~') ? text.slice(1) : text;
  return /^[a-z0-9][a-z0-9_-]{0,127}$/u.test(body) ? text : `id_${sha256(text).slice(0, 24)}`;
}
