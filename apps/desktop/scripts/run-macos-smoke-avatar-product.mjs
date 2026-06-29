import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(scriptDir, '..');
const repoRoot = path.resolve(desktopRoot, '..', '..');

export const LIVE2D_AVATAR_PRODUCT_SMOKE_SCENARIO = 'chat.live2d-avatar-product-smoke';
export const LIVE2D_AVATAR_LOCAL_ASSET_MISSING_SMOKE_SCENARIO = 'chat.live2d-avatar-local-asset-missing-smoke';
export const LIVE2D_AVATAR_PRODUCT_BOOTSTRAP_TIMEOUT_MS = 120000;
export const AVATAR_PRODUCT_SMOKE_APP_REGISTRY_FILENAME = 'nimi-app-registry.yaml';
export const AVATAR_PRODUCT_SMOKE_RELEASE_DESCRIPTORS_FILENAME = 'nimi-app-release-descriptors.yaml';
export const AVATAR_PRODUCT_CANONICAL_APP_REGISTRY_PATH = path.join(
  repoRoot,
  '.nimi/spec/platform/kernel/tables/nimi-app-registry.yaml',
);
export const AVATAR_PRODUCT_CANONICAL_RELEASE_DESCRIPTORS_PATH = path.join(
  repoRoot,
  '.nimi/spec/platform/kernel/tables/nimi-app-release-descriptors.yaml',
);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function firstExistingLive2dModelFile(root) {
  const entries = fs.readdirSync(root, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(root, entry.name);
    if (entry.isFile() && entry.name.endsWith('.model3.json')) {
      return entryPath;
    }
  }
  return '';
}

export function ensureAvatarProductLive2dSampleRoot() {
  const configuredRoot = String(process.env.NIMI_AVATAR_PRODUCT_LIVE2D_ROOT || '').trim();
  if (!configuredRoot) {
    return null;
  }
  if (!path.isAbsolute(configuredRoot)) {
    throw new Error('NIMI_AVATAR_PRODUCT_LIVE2D_ROOT must be absolute');
  }
  if (!fs.existsSync(configuredRoot) || !fs.statSync(configuredRoot).isDirectory()) {
    throw new Error(`NIMI_AVATAR_PRODUCT_LIVE2D_ROOT does not exist or is not a directory: ${configuredRoot}`);
  }

  const runtimeRoot = fs.existsSync(path.join(configuredRoot, 'runtime'))
    && fs.statSync(path.join(configuredRoot, 'runtime')).isDirectory()
    ? path.join(configuredRoot, 'runtime')
    : configuredRoot;
  const modelPath = firstExistingLive2dModelFile(runtimeRoot);
  if (!modelPath) {
    throw new Error(`NIMI_AVATAR_PRODUCT_LIVE2D_ROOT must contain a runtime *.model3.json file: ${configuredRoot}`);
  }
  return {
    modelName: path.basename(modelPath, '.model3.json'),
    sampleRoot: runtimeRoot,
    modelFileUrl: pathToFileURL(modelPath).toString(),
  };
}

function runChecked(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: 'inherit',
    ...options,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited with status ${result.status}`);
  }
}

export function ensureAvatarProductSmokeLaunchTarget() {
  const configuredApp = String(process.env.NIMI_AVATAR_APP_PATH || '').trim();
  if (configuredApp) {
    if (!path.isAbsolute(configuredApp)) {
      throw new Error('NIMI_AVATAR_APP_PATH must be absolute');
    }
    if (!fs.existsSync(configuredApp)) {
      throw new Error(`NIMI_AVATAR_APP_PATH does not exist: ${configuredApp}`);
    }
    return { appPath: configuredApp, binaryPath: '' };
  }

  const configuredBinary = String(process.env.NIMI_AVATAR_BINARY_PATH || '').trim();
  if (configuredBinary) {
    if (!path.isAbsolute(configuredBinary)) {
      throw new Error('NIMI_AVATAR_BINARY_PATH must be absolute');
    }
    if (!fs.existsSync(configuredBinary)) {
      throw new Error(`NIMI_AVATAR_BINARY_PATH does not exist: ${configuredBinary}`);
    }
    return { appPath: '', binaryPath: configuredBinary };
  }

  runChecked('pnpm', [
    '--filter',
    '@nimiplatform/avatar',
    'exec',
    'tauri',
    'build',
    '--bundles',
    'app',
    '--no-sign',
  ]);
  const appPath = path.join(repoRoot, 'apps/avatar/src-tauri/target/release/bundle/macos/Nimi Avatar.app');
  if (!fs.existsSync(appPath)) {
    throw new Error(`Avatar product smoke app bundle was not produced: ${appPath}`);
  }
  return { appPath, binaryPath: '' };
}

export function runtimeProductSmokeTauriFixture(profile, scenarioId) {
  const fixture = {
    ...(profile.tauriFixture || {}),
  };
  if (isLive2dAvatarProductScenario(scenarioId)) {
    delete fixture.runtimeBridgeStatus;
    delete fixture.desktopReleaseInfo;
  }
  return fixture;
}

export function isLive2dAvatarProductScenario(scenarioId) {
  return scenarioId === LIVE2D_AVATAR_PRODUCT_SMOKE_SCENARIO
    || scenarioId === LIVE2D_AVATAR_LOCAL_ASSET_MISSING_SMOKE_SCENARIO;
}


function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

export function ensureCleanSymlink(targetPath, linkPath) {
  fs.rmSync(linkPath, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(linkPath), { recursive: true });
  fs.symlinkSync(targetPath, linkPath, 'dir');
}

export function createAvatarProductSmokeLive2dPackage(artifactsDir, cubismSample) {
  if (!cubismSample?.sampleRoot) {
    return null;
  }
  const packageRoot = path.join(artifactsDir, 'live2d-product-asset');
  const runtimeLink = path.join(packageRoot, 'runtime');
  ensureCleanSymlink(cubismSample.sampleRoot, runtimeLink);
  const modelFilename = `${cubismSample.modelName}.model3.json`;
  return {
    packageRoot,
    runtimeLink,
    sampleRoot: cubismSample.sampleRoot,
    modelFilename,
    presentationProfile: {
      backendKind: 'live2d',
      avatarAssetRef: packageRoot,
      expressionProfileRef: '',
      idlePreset: 'default',
      interactionPolicyRef: 'product-smoke',
      defaultVoiceReference: '',
    },
  };
}

export function writeAvatarProductSmokeAppRegistryProjection(runtimeDir) {
  fs.mkdirSync(runtimeDir, { recursive: true });
  const registryPath = path.join(runtimeDir, AVATAR_PRODUCT_SMOKE_APP_REGISTRY_FILENAME);
  const releaseDescriptorsPath = path.join(runtimeDir, AVATAR_PRODUCT_SMOKE_RELEASE_DESCRIPTORS_FILENAME);
  const registryText = readRequiredCanonicalProjection(
    AVATAR_PRODUCT_CANONICAL_APP_REGISTRY_PATH,
    [
      'owner: platform',
      'app_id: nimi.avatar',
      'ordinary_visibility: hidden-internal',
      'release_descriptor_ref: nimi.avatar.bundled-with-nimi',
    ],
  );
  const releaseDescriptorsText = readRequiredCanonicalProjection(
    AVATAR_PRODUCT_CANONICAL_RELEASE_DESCRIPTORS_PATH,
    [
      'owner: platform',
      'descriptor_id: nimi.avatar.bundled-with-nimi',
      'app_id: nimi.avatar',
      'descriptor_class: bundled-with-nimi',
    ],
  );
  fs.writeFileSync(registryPath, registryText, 'utf8');
  fs.writeFileSync(releaseDescriptorsPath, releaseDescriptorsText, 'utf8');
  return {
    registryPath,
    releaseDescriptorsPath,
    registrySourcePath: AVATAR_PRODUCT_CANONICAL_APP_REGISTRY_PATH,
    releaseDescriptorsSourcePath: AVATAR_PRODUCT_CANONICAL_RELEASE_DESCRIPTORS_PATH,
  };
}

function readRequiredCanonicalProjection(filePath, requiredSnippets) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`canonical avatar product projection is missing: ${filePath}`);
  }
  const text = fs.readFileSync(filePath, 'utf8');
  for (const snippet of requiredSnippets) {
    if (!text.includes(snippet)) {
      throw new Error(`canonical avatar product projection ${filePath} is missing required identity: ${snippet}`);
    }
  }
  return text;
}

function sha256FileHex(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function avatarAssetContentDigest(files) {
  const hash = crypto.createHash('sha256');
  for (const file of files) {
    hash.update(file.path);
    hash.update(Buffer.from([0]));
    hash.update(file.sha256);
    hash.update(Buffer.from([0]));
    hash.update(String(file.bytes));
    hash.update(Buffer.from([0]));
  }
  return hash.digest('hex');
}

function createAvatarProductSmokeLive2dAdapterManifest(avatarProductLive2dPackage) {
  const modelId = avatarProductLive2dPackage.modelFilename.replace(/\.model3\.json$/, '');
  return {
    manifest_kind: 'nimi.avatar.live2d.adapter',
    schema_version: 1,
    adapter_id: `${modelId}-product-smoke-semantic-basic`,
    target_model: {
      model_id: modelId,
      model3: avatarProductLive2dPackage.modelFilename,
    },
    license: {
      redistribution: 'unknown',
      evidence: `operator-local resource path: ${avatarProductLive2dPackage.sampleRoot}`,
      fixture_use: 'operator_local_only',
    },
    compatibility: {
      requested_tier: 'semantic_basic',
    },
    semantics: {
      motions: {
        idle: { group: 'Idle' },
        activities: {
          neutral: { group: 'Idle' },
          greet: { group: 'Idle' },
          listening: { group: 'Idle' },
          thinking: { group: 'Idle' },
        },
        missing_activity: 'idle_degraded_with_diagnostic',
      },
      expressions: {
        map: {
          joy: 'exp_01',
        },
        disposition: { status: 'supported' },
      },
      poses: {
        disposition: { status: 'not_applicable', reason: 'render-only smoke does not assert pose semantics' },
      },
      lipsync: {
        mouth_open_y_parameter: 'ParamMouthOpenY',
        disposition: { status: 'supported' },
      },
      physics: {
        mode: 'model_physics',
        disposition: { status: 'supported' },
      },
      hit_regions: {
        map: {
          head: ['HitAreaHead', 'Head'],
          body: ['HitAreaBody', 'Body'],
        },
        fallback: 'alpha_mask_only',
        disposition: { status: 'supported' },
      },
      nas_fallback: {
        default_idle_motion: 'Idle',
        missing_handler: 'backend_default_with_diagnostic',
      },
    },
  };
}

function canUseRawScopePathSegment(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 128) {
    return false;
  }
  if (value === '.' || value === '..') {
    return false;
  }
  const first = value[0];
  return /[a-z0-9]/.test(first) && /^[a-z0-9_-]+$/.test(value);
}

function localScopePathSegment(value) {
  if (canUseRawScopePathSegment(value)) {
    return value;
  }
  return `id_${crypto.createHash('sha256').update(value).digest('hex').slice(0, 24)}`;
}

function resolveProductControlDataRootPath(productControlRecord) {
  const configured = typeof productControlRecord?.dataRoot?.path === 'string'
    ? productControlRecord.dataRoot.path.trim()
    : '';
  if (!configured) {
    return '';
  }
  if (!path.isAbsolute(configured)) {
    throw new Error(`productControlRecord.dataRoot.path must be absolute: ${configured}`);
  }
  return path.normalize(configured);
}

function resolveNimiDataDir(productControlRecord = null) {
  const productControlDataRoot = resolveProductControlDataRootPath(productControlRecord);
  if (productControlDataRoot) {
    return productControlDataRoot;
  }
  const home = process.env.HOME || process.env.USERPROFILE || '';
  if (!home) {
    throw new Error('cannot resolve HOME for avatar product smoke Agent Center config');
  }
  const nimiDir = path.join(home, '.nimi');
  const productControlPath = path.join(nimiDir, 'nimi.json');
  if (!fs.existsSync(productControlPath)) {
    throw new Error(`cannot seed avatar product smoke Agent Center config without selected product data root: missing ${productControlPath}`);
  }
  const productControlDataRootFromDisk = resolveProductControlDataRootPath(readJson(productControlPath));
  if (!productControlDataRootFromDisk) {
    throw new Error(`cannot seed avatar product smoke Agent Center config without selected product data root: ${productControlPath} has no dataRoot.path`);
  }
  return productControlDataRootFromDisk;
}

export function seedAvatarProductSmokeAgentCenterConfig(avatarProductLive2dPackage, productControlRecord = null) {
  if (!avatarProductLive2dPackage?.packageRoot || !avatarProductLive2dPackage?.sampleRoot) {
    return null;
  }
  const accountId = 'user-e2e-primary';
  const ownerUserId = 'user-e2e-primary';
  const runtimeSourceRef = 'agent-e2e-alpha';
  const localAgentRef = 'local-agent:desktop-e2e-alpha';
  const packageHash = crypto.createHash('sha256')
    .update(path.resolve(avatarProductLive2dPackage.packageRoot))
    .digest('hex')
    .slice(0, 12);
  const dataDir = resolveNimiDataDir(productControlRecord);
  const localAssetId = `live2d_${packageHash}`;
  const packageDir = path.join(
    dataDir,
    'accounts',
    localScopePathSegment(accountId),
    'agents',
    localScopePathSegment(localAgentRef),
    'agent-center',
    'modules',
    'avatar_asset',
    'packages',
    'live2d',
    localAssetId,
  );
  const filesDir = path.join(packageDir, 'files');
  fs.rmSync(packageDir, { recursive: true, force: true });
  fs.mkdirSync(filesDir, { recursive: true });
  fs.cpSync(avatarProductLive2dPackage.sampleRoot, filesDir, {
    recursive: true,
    dereference: true,
  });
  const entryFile = `files/${avatarProductLive2dPackage.modelFilename}`;
  const entryPath = path.join(packageDir, entryFile);
  const adapterManifestFile = 'files/nimi/live2d-adapter.json';
  const adapterManifestPath = path.join(packageDir, adapterManifestFile);
  fs.mkdirSync(path.dirname(adapterManifestPath), { recursive: true });
  writeJson(adapterManifestPath, createAvatarProductSmokeLive2dAdapterManifest(avatarProductLive2dPackage));
  const entryBytes = fs.statSync(entryPath).size;
  const entrySha256 = sha256FileHex(entryPath);
  const adapterManifestBytes = fs.statSync(adapterManifestPath).size;
  const adapterManifestSha256 = sha256FileHex(adapterManifestPath);
  const manifestFiles = [
    {
      path: entryFile,
      sha256: entrySha256,
      bytes: entryBytes,
      mime: 'application/json',
    },
    {
      path: adapterManifestFile,
      sha256: adapterManifestSha256,
      bytes: adapterManifestBytes,
      mime: 'application/json',
    },
  ];
  writeJson(path.join(packageDir, 'manifest.json'), {
    manifest_version: 1,
    asset_version: '1.0.0',
    local_asset_id: localAssetId,
    kind: 'live2d',
    loader_min_version: '1.0.0',
    display_name: avatarProductLive2dPackage.modelFilename.replace(/\.model3\.json$/, ''),
    display_name_i18n: {},
    entry_file: entryFile,
    required_files: [entryFile, adapterManifestFile],
    content_digest: avatarAssetContentDigest(manifestFiles),
    files: manifestFiles,
    limits: {
      max_manifest_bytes: 262144,
      max_asset_bytes: 524288000,
      max_file_bytes: 104857600,
      max_file_count: 2048,
    },
    capabilities: {
      backend_kind: 'live2d',
      embedded_live2d_adapter_manifest: true,
    },
    import: {
      imported_at: new Date().toISOString(),
      source_label: path.basename(avatarProductLive2dPackage.sampleRoot),
      source_fingerprint: crypto.createHash('sha256').update(entrySha256).digest('hex'),
    },
  });
  const config = {
    schema_version: 1,
    config_kind: 'agent_center_local_config',
    account_id: accountId,
    owner_user_id: ownerUserId,
    runtime_source_ref: runtimeSourceRef,
    local_agent_ref: localAgentRef,
    modules: {
      appearance: {
        schema_version: 1,
        background_asset_id: null,
        motion: 'system',
      },
      avatar_asset: {
        schema_version: 1,
        conversation_anchor_scope: 'current_anchor',
        local_avatar_asset_ref: localAssetId,
        live2d_adapter_manifest_source: 'embedded_creator_manifest',
        live2d_adapter_manifest_ref: null,
        avatar_instance_policy: 'reuse_active_instance',
        backend_kind: 'live2d',
        backend_capability_profile_ref: null,
        generated_motion_provider_policy: 'require_profile_support',
        launch_mode: 'manual',
        debug_profile: 'strict_backend_evidence',
        updated_at: new Date().toISOString(),
        provenance: {
          source: 'import_validation',
          evidence_ref: 'avatar-product-smoke-live2d-agent-center-fixture-seed',
        },
      },
      local_history: {
        schema_version: 1,
        last_cleared_at: null,
      },
      ui: {
        schema_version: 1,
        last_section: 'overview',
      },
    },
  };
  const configPath = path.join(
    dataDir,
    'accounts',
    localScopePathSegment(accountId),
    'agents',
    localScopePathSegment(localAgentRef),
    'agent-center',
    'config.json',
  );
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  writeJson(configPath, config);
  return {
    configPath,
    dataDir,
    accountId,
    ownerUserId,
    runtimeSourceRef,
    localAgentRef,
    packageDir,
    avatarAssetRef: config.modules.avatar_asset.local_avatar_asset_ref,
    backendCapabilityProfileRef: config.modules.avatar_asset.backend_capability_profile_ref,
  };
}

export function applyAvatarProductSmokeLocalAssetFault(agentCenterConfig, faultKind) {
  if (!agentCenterConfig || faultKind !== 'missing_entry_file') {
    return null;
  }
  const manifestPath = path.join(agentCenterConfig.packageDir, 'manifest.json');
  const manifest = readJson(manifestPath);
  const entryFile = typeof manifest.entry_file === 'string' ? manifest.entry_file.trim() : '';
  if (!entryFile) {
    throw new Error(`cannot apply Avatar product local asset fault without manifest entry_file: ${manifestPath}`);
  }
  const entryPath = path.join(agentCenterConfig.packageDir, entryFile);
  fs.rmSync(entryPath, { force: true });
  return {
    faultKind,
    manifestPath,
    removedEntryPath: entryPath,
  };
}

function sanitizeAvatarProjectionComponent(input) {
  const raw = String(input || '').trim();
  let out = '';
  for (const ch of raw) {
    if (/[a-zA-Z0-9_-]/.test(ch)) {
      out += ch;
    } else {
      out += '_';
    }
  }
  const trimmed = out.replace(/^_+|_+$/g, '');
  return trimmed || 'avatar-instance';
}

function removeAvatarInstanceRegistryEntries(dataDir, localAgentRef) {
  const registryPath = path.join(dataDir, 'avatar-instance-registry', 'instances.json');
  if (!fs.existsSync(registryPath)) {
    return { registryPath, removed: 0 };
  }
  const parsed = readJson(registryPath);
  const instances = Array.isArray(parsed.instances) ? parsed.instances : [];
  const retained = instances.filter((instance) => instance?.localAgentRef !== localAgentRef);
  const removed = instances.length - retained.length;
  if (removed <= 0) {
    return { registryPath, removed: 0 };
  }
  if (retained.length === 0) {
    fs.rmSync(registryPath, { force: true });
    return { registryPath, removed };
  }
  writeJson(registryPath, {
    ...parsed,
    instances: retained,
  });
  return { registryPath, removed };
}

function removeAvatarCarrierEvidenceFiles(dataDir, localAgentRef) {
  const evidenceDir = path.join(dataDir, 'avatar-carrier-evidence');
  if (!fs.existsSync(evidenceDir)) {
    return { evidenceDir, removed: [] };
  }
  const localAgentSegment = sanitizeAvatarProjectionComponent(`desktop-avatar-${String(localAgentRef || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}`);
  const removed = [];
  for (const entry of fs.readdirSync(evidenceDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) {
      continue;
    }
    if (!entry.name.startsWith(localAgentSegment)) {
      continue;
    }
    const filePath = path.join(evidenceDir, entry.name);
    fs.rmSync(filePath, { force: true });
    removed.push(filePath);
  }
  return { evidenceDir, removed };
}

export function resetAvatarProductSmokeProjections(agentCenterConfig) {
  if (!agentCenterConfig?.localAgentRef) {
    return null;
  }
  const dataDir = agentCenterConfig.dataDir || resolveNimiDataDir();
  return {
    dataDir,
    localAgentRef: agentCenterConfig.localAgentRef,
    instanceRegistry: removeAvatarInstanceRegistryEntries(dataDir, agentCenterConfig.localAgentRef),
    carrierEvidence: removeAvatarCarrierEvidenceFiles(dataDir, agentCenterConfig.localAgentRef),
  };
}

export function withAgentPresentationProfile(agent, presentationProfile) {
  if (!agent || typeof agent !== 'object' || Array.isArray(agent) || !presentationProfile) {
    return agent;
  }
  const next = {
    ...agent,
    presentationProfile,
  };
  const sourceProfile = next.sourceProfile && typeof next.sourceProfile === 'object' && !Array.isArray(next.sourceProfile)
    ? next.sourceProfile
    : {};
  next.sourceProfile = {
    ...sourceProfile,
    presentationProfile,
  };
  return next;
}

export function applyAvatarProductPresentationProfile(profile, scenarioId, presentationProfile) {
  const next = cloneJson(profile);
  if (!isLive2dAvatarProductScenario(scenarioId) || !presentationProfile) {
    return next;
  }
  const realmFixture = next.realmFixture || {};
  next.realmFixture = realmFixture;
  if (Array.isArray(realmFixture.creatorAgents)) {
    realmFixture.creatorAgents = realmFixture.creatorAgents.map((agent) => (
      agent?.id === 'agent-e2e-alpha'
        ? withAgentPresentationProfile(agent, presentationProfile)
        : agent
    ));
  }
  if (!realmFixture.friends || typeof realmFixture.friends !== 'object' || Array.isArray(realmFixture.friends)) {
    realmFixture.friends = { items: [] };
  }
  const friends = Array.isArray(realmFixture.friends.items) ? realmFixture.friends.items : [];
  const existingFriendIndex = friends.findIndex((friend) => friend?.id === 'agent-e2e-alpha');
  const creatorAgent = Array.isArray(realmFixture.creatorAgents)
    ? realmFixture.creatorAgents.find((agent) => agent?.id === 'agent-e2e-alpha')
    : null;
  const agentFriend = withAgentPresentationProfile({
    ...(creatorAgent || {}),
    id: 'agent-e2e-alpha',
    displayName: creatorAgent?.displayName || 'Fixture Agent',
    handle: creatorAgent?.handle || '~fixture-agent',
    avatarUrl: creatorAgent?.avatarUrl || '',
    bio: creatorAgent?.bio || 'Seeded creator agent',
    isAgent: true,
  }, presentationProfile);
  realmFixture.friends.items = existingFriendIndex >= 0
    ? friends.map((friend, index) => (index === existingFriendIndex ? withAgentPresentationProfile(friend, presentationProfile) : friend))
    : [...friends, agentFriend];
  if (Array.isArray(realmFixture.searchUsers?.items)) {
    realmFixture.searchUsers.items = realmFixture.searchUsers.items.map((agent) => (
      agent?.id === 'agent-e2e-alpha'
        ? withAgentPresentationProfile(agent, presentationProfile)
        : agent
    ));
  }
  if (Array.isArray(realmFixture.worlds)) {
    realmFixture.worlds = realmFixture.worlds.map((world) => {
      if (!world || typeof world !== 'object' || Array.isArray(world) || !Array.isArray(world.agents)) {
        return world;
      }
      return {
        ...world,
        agents: world.agents.map((agent) => (
          agent?.id === 'agent-e2e-alpha'
            ? withAgentPresentationProfile(agent, presentationProfile)
            : agent
        )),
      };
    });
  }
  return next;
}
