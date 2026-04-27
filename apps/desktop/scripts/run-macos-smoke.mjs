#!/usr/bin/env node

import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  isDynamicLive2dSampleScenario,
  profilePathForScenario,
  scenarioEntryForId,
  selectScenarios,
} from '../e2e/helpers/registry.mjs';
import { startRealmFixtureServer } from '../e2e/fixtures/realm-fixture-server.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(scriptDir, '..');
const repoRoot = path.resolve(desktopRoot, '..', '..');
const CUBISM_WEB_SDK_VERSION = '5-r.5';
const DEFAULT_CUBISM_SAMPLE_MODEL = 'Hiyori';
const LIVE2D_SMOKE_SCENARIO_PREFIX = 'chat.live2d-render-smoke-';
const LIVE2D_AVATAR_PRODUCT_SMOKE_SCENARIO = 'chat.live2d-avatar-product-smoke';
const LIVE2D_AVATAR_PRODUCT_BOOTSTRAP_TIMEOUT_MS = 120000;
const VRM_SAMPLE_CATALOG = {
  'chat.vrm-lifecycle-smoke': {
    resourceId: 'fixture-vrm-constraint-twist',
    displayName: 'Fixture Constraint Twist VRM',
    filename: 'VRM1_Constraint_Twist_Sample.vrm',
    sourceUrl: 'https://raw.githubusercontent.com/pixiv/three-vrm/release/packages/three-vrm/examples/models/VRM1_Constraint_Twist_Sample.vrm',
  },
  'chat.vrm-speaking-smoke': {
    resourceId: 'fixture-vrm-constraint-twist',
    displayName: 'Fixture Constraint Twist VRM',
    filename: 'VRM1_Constraint_Twist_Sample.vrm',
    sourceUrl: 'https://raw.githubusercontent.com/pixiv/three-vrm/release/packages/three-vrm/examples/models/VRM1_Constraint_Twist_Sample.vrm',
  },
  'chat.vrm-speaking-smoke-no-viseme': {
    resourceId: 'fixture-vrm-constraint-twist',
    displayName: 'Fixture Constraint Twist VRM',
    filename: 'VRM1_Constraint_Twist_Sample.vrm',
    sourceUrl: 'https://raw.githubusercontent.com/pixiv/three-vrm/release/packages/three-vrm/examples/models/VRM1_Constraint_Twist_Sample.vrm',
  },
  'chat.vrm-listening-smoke': {
    resourceId: 'fixture-vrm-constraint-twist',
    displayName: 'Fixture Constraint Twist VRM',
    filename: 'VRM1_Constraint_Twist_Sample.vrm',
    sourceUrl: 'https://raw.githubusercontent.com/pixiv/three-vrm/release/packages/three-vrm/examples/models/VRM1_Constraint_Twist_Sample.vrm',
  },
  'chat.vrm-thinking-smoke': {
    resourceId: 'fixture-vrm-constraint-twist',
    displayName: 'Fixture Constraint Twist VRM',
    filename: 'VRM1_Constraint_Twist_Sample.vrm',
    sourceUrl: 'https://raw.githubusercontent.com/pixiv/three-vrm/release/packages/three-vrm/examples/models/VRM1_Constraint_Twist_Sample.vrm',
  },
  'chat.vrm-lifecycle-smoke-avatar-sample-a': {
    resourceId: 'fixture-vrm-avatar-sample-a',
    displayName: 'Fixture Avatar Sample A VRM',
    filename: 'AvatarSample_A.vrm',
    sourceUrl: 'https://raw.githubusercontent.com/madjin/vrm-samples/master/vroid/stable/AvatarSample_A.vrm',
  },
  'chat.vrm-lifecycle-smoke-avatar-sample-b': {
    resourceId: 'fixture-vrm-avatar-sample-b',
    displayName: 'Fixture Avatar Sample B VRM',
    filename: 'AvatarSample_B.vrm',
    sourceUrl: 'https://raw.githubusercontent.com/pixiv/local-chat-vrm/main/public/AvatarSample_B.vrm',
  },
};

function ensureCubismLive2dSample(modelName = DEFAULT_CUBISM_SAMPLE_MODEL) {
  const sampleCacheRoot = path.join(repoRoot, 'apps/desktop/.cache/assets/js');
  const sdkRoot = path.join(sampleCacheRoot, `CubismSdkForWeb-${CUBISM_WEB_SDK_VERSION}`);
  const zipPath = path.join(sdkRoot, `CubismSdkForWeb-${CUBISM_WEB_SDK_VERSION}.zip`);
  const modelPath = path.join(
    sdkRoot,
    'Samples',
    'Resources',
    modelName,
    `${modelName}.model3.json`,
  );

  if (!fs.existsSync(zipPath)) {
    throw new Error(`Cubism Web SDK zip is missing: ${zipPath}`);
  }
  if (!fs.existsSync(modelPath)) {
    const entry = `CubismSdkForWeb-${CUBISM_WEB_SDK_VERSION}/Samples/Resources/${modelName}/*`;
    const extract = spawnSync('unzip', ['-oq', zipPath, entry, '-d', sampleCacheRoot], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    if (extract.error) {
      throw extract.error;
    }
    if (extract.status !== 0) {
      throw new Error(`failed to extract Cubism sample ${modelName}: ${extract.stderr || extract.stdout || 'unknown unzip error'}`);
    }
  }
  return {
    modelName,
    sampleRoot: path.dirname(modelPath),
    modelFileUrl: pathToFileURL(modelPath).toString(),
  };
}

function vrmSampleDefinitionForScenario(scenarioId) {
  return VRM_SAMPLE_CATALOG[scenarioId] || null;
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

function ensureAvatarProductSmokeLaunchTarget() {
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

async function ensureVrmSample(sampleDefinition) {
  const sampleCacheRoot = path.join(repoRoot, 'apps/desktop/.cache/assets/vrm');
  const samplePath = path.join(sampleCacheRoot, sampleDefinition.filename);
  fs.mkdirSync(sampleCacheRoot, { recursive: true });
  if (!fs.existsSync(samplePath) || fs.statSync(samplePath).size <= 0) {
    const response = await fetch(sampleDefinition.sourceUrl);
    if (!response.ok) {
      throw new Error(`failed to download VRM sample ${sampleDefinition.sourceUrl}: ${response.status} ${response.statusText}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    fs.writeFileSync(samplePath, Buffer.from(arrayBuffer));
  }
  return {
    ...sampleDefinition,
    sampleRoot: sampleCacheRoot,
    sampleFileUrl: pathToFileURL(samplePath).toString(),
  };
}

function cubismSampleModelForScenario(scenarioId) {
  switch (scenarioId) {
    case 'chat.live2d-render-smoke-mark':
    case 'chat.live2d-render-smoke-mark-speaking':
      return 'Mark';
    case 'chat.live2d-render-smoke':
      return DEFAULT_CUBISM_SAMPLE_MODEL;
    default:
      if (scenarioId.startsWith(LIVE2D_SMOKE_SCENARIO_PREFIX)) {
        const suffix = scenarioId.slice(LIVE2D_SMOKE_SCENARIO_PREFIX.length);
        if (suffix) {
          return suffix
            .split('-')
            .filter(Boolean)
            .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
            .join('');
        }
      }
      return DEFAULT_CUBISM_SAMPLE_MODEL;
  }
}

function cubismSampleProfileTokensForScenario(scenarioId) {
  const modelName = cubismSampleModelForScenario(scenarioId);
  return {
    resourceId: `fixture-live2d-${modelName.toLowerCase()}`,
    displayName: `Fixture ${modelName} Live2D`,
    modelFilename: `${modelName}.model3.json`,
  };
}

function parseArgs(argv) {
  const options = {
    suite: 'all',
    scenario: '',
    skipBuild: false,
    timeoutMs: 45000,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--suite') {
      options.suite = String(argv[index + 1] || 'all');
      index += 1;
      continue;
    }
    if (arg === '--scenario') {
      options.scenario = String(argv[index + 1] || '');
      index += 1;
      continue;
    }
    if (arg === '--timeout-ms') {
      options.timeoutMs = Number(argv[index + 1] || '45000') || 45000;
      index += 1;
      continue;
    }
    if (arg === '--skip-build') {
      options.skipBuild = true;
    }
  }
  return options;
}

function mergeDeep(baseValue, overrideValue) {
  if (Array.isArray(baseValue) || Array.isArray(overrideValue)) {
    return overrideValue === undefined ? baseValue : overrideValue;
  }
  if (baseValue && typeof baseValue === 'object' && overrideValue && typeof overrideValue === 'object') {
    const merged = { ...baseValue };
    for (const [key, value] of Object.entries(overrideValue)) {
      merged[key] = mergeDeep(baseValue[key], value);
    }
    return merged;
  }
  return overrideValue === undefined ? baseValue : overrideValue;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function loadProfileDefinition(filePath, seen = new Set()) {
  const normalizedPath = path.resolve(filePath);
  if (seen.has(normalizedPath)) {
    throw new Error(`E2E profile extends cycle detected: ${normalizedPath}`);
  }
  seen.add(normalizedPath);
  const current = readJson(normalizedPath);
  const parentName = String(current.extends || '').trim();
  if (!parentName) {
    return current;
  }
  const parentPath = path.resolve(path.dirname(normalizedPath), parentName);
  const parent = loadProfileDefinition(parentPath, seen);
  const rest = { ...current };
  delete rest.extends;
  return mergeDeep(parent, rest);
}

function replacePlaceholders(value, replacements) {
  if (Array.isArray(value)) {
    return value.map((item) => replacePlaceholders(item, replacements));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replacePlaceholders(item, replacements)]));
  }
  if (typeof value === 'string') {
    return Object.entries(replacements).reduce(
      (result, [token, replacement]) => result.replaceAll(token, replacement),
      value,
    );
  }
  return value;
}

function runtimeProductSmokeTauriFixture(profile, scenarioId) {
  const fixture = {
    ...(profile.tauriFixture || {}),
  };
  if (scenarioId === LIVE2D_AVATAR_PRODUCT_SMOKE_SCENARIO) {
    delete fixture.runtimeBridgeStatus;
    delete fixture.desktopReleaseInfo;
  }
  return fixture;
}

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function ensureCleanSymlink(targetPath, linkPath) {
  fs.rmSync(linkPath, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(linkPath), { recursive: true });
  fs.symlinkSync(targetPath, linkPath, 'dir');
}

function createAvatarProductSmokeLive2dPackage(artifactsDir, cubismSample) {
  if (!cubismSample?.sampleRoot) {
    return null;
  }
  const packageRoot = path.join(artifactsDir, 'live2d-product-asset');
  const runtimeLink = path.join(packageRoot, 'runtime');
  ensureCleanSymlink(cubismSample.sampleRoot, runtimeLink);
  return {
    packageRoot,
    runtimeLink,
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

function withAgentPresentationProfile(agent, presentationProfile) {
  if (!agent || typeof agent !== 'object' || Array.isArray(agent) || !presentationProfile) {
    return agent;
  }
  const next = {
    ...agent,
    presentationProfile,
  };
  const agentProfile = next.agentProfile && typeof next.agentProfile === 'object' && !Array.isArray(next.agentProfile)
    ? next.agentProfile
    : {};
  next.agentProfile = {
    ...agentProfile,
    presentationProfile,
  };
  return next;
}

function applyAvatarProductPresentationProfile(profile, scenarioId, presentationProfile) {
  const next = cloneJson(profile);
  if (scenarioId !== LIVE2D_AVATAR_PRODUCT_SMOKE_SCENARIO || !presentationProfile) {
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

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function escapeXmlText(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function findFreeLoopbackPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        if (!address || typeof address === 'string') {
          reject(new Error('failed to allocate loopback port'));
          return;
        }
        resolve(address.port);
      });
    });
  });
}

async function startOpenAiCompatibleSmokeProvider() {
  const modelId = 'e2e-live2d-text-route';
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url || '/', 'http://127.0.0.1');
    const writeJsonResponse = (statusCode, payload) => {
      response.writeHead(statusCode, {
        'content-type': 'application/json',
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET,POST,OPTIONS',
        'access-control-allow-headers': 'content-type,authorization',
      });
      response.end(JSON.stringify(payload));
    };
    if (request.method === 'OPTIONS') {
      writeJsonResponse(204, {});
      return;
    }
    if (request.method === 'GET' && (url.pathname === '/v1/models' || url.pathname === '/models')) {
      writeJsonResponse(200, {
        object: 'list',
        data: [{
          id: modelId,
          object: 'model',
          created: 0,
          owned_by: 'nimi-e2e',
        }],
      });
      return;
    }
    if (request.method === 'POST' && (url.pathname === '/v1/chat/completions' || url.pathname === '/chat/completions')) {
      let body = '';
      for await (const chunk of request) {
        body += chunk.toString('utf8');
      }
      const parsed = body ? JSON.parse(body) : {};
      const userMessage = Array.isArray(parsed.messages)
        ? [...parsed.messages].reverse().find((message) => message?.role === 'user')?.content
        : '';
      const content = `<message id="e2e-live2d-smoke-message">Runtime product smoke acknowledged: ${escapeXmlText(String(userMessage || 'ready').slice(0, 80))}</message>`;
      if (parsed.stream === true) {
        response.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
          'access-control-allow-origin': '*',
        });
        response.write(`data: ${JSON.stringify({
          id: `chatcmpl-e2e-${Date.now().toString(36)}`,
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: modelId,
          choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }],
        })}\n\n`);
        response.write(`data: ${JSON.stringify({
          id: `chatcmpl-e2e-${Date.now().toString(36)}`,
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: modelId,
          choices: [{ index: 0, delta: { content }, finish_reason: null }],
        })}\n\n`);
        response.write(`data: ${JSON.stringify({
          id: `chatcmpl-e2e-${Date.now().toString(36)}`,
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: modelId,
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          usage: {
            prompt_tokens: 8,
            completion_tokens: 8,
            total_tokens: 16,
          },
        })}\n\n`);
        response.end('data: [DONE]\n\n');
        return;
      }
      writeJsonResponse(200, {
        id: `chatcmpl-e2e-${Date.now().toString(36)}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: modelId,
        choices: [{
          index: 0,
          finish_reason: 'stop',
          message: {
            role: 'assistant',
            content,
          },
        }],
        usage: {
          prompt_tokens: 8,
          completion_tokens: 8,
          total_tokens: 16,
        },
      });
      return;
    }
    writeJsonResponse(404, { error: 'fixture_not_found', pathname: url.pathname });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    await new Promise((resolve) => server.close(resolve));
    throw new Error('failed to start OpenAI-compatible smoke provider');
  }
  return {
    modelId,
    endpoint: `http://127.0.0.1:${address.port}/v1`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function writeAvatarProductRuntimeLocalState(statePath, provider) {
  const now = new Date().toISOString();
  writeJson(statePath, {
    schemaVersion: 2,
    savedAt: now,
    assets: [{
      localAssetId: 'local-e2e-live2d-text-route',
      assetId: provider.modelId,
      kind: 1,
      engine: 'llama',
      entry: '',
      files: [],
      license: 'e2e-fixture',
      sourceRepo: 'e2e/product-smoke',
      sourceRevision: 'local',
      hashes: {},
      status: 2,
      installedAt: now,
      updatedAt: now,
      healthDetail: 'E2E OpenAI-compatible text route',
      engineRuntimeMode: 2,
      endpoint: provider.endpoint,
      capabilities: ['chat', 'text.generate'],
      logicalModelId: 'nimi/e2e-live2d-text-route',
      family: 'e2e',
      artifactRoles: ['llm'],
    }],
    services: [],
  });
}

function base64UrlEncode(value) {
  return Buffer.from(value)
    .toString('base64')
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '');
}

function signJwtRS256(privateKey, kid, claims) {
  const header = {
    alg: 'RS256',
    typ: 'JWT',
    kid,
  };
  const signingInput = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(claims))}`;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(signingInput), privateKey);
  return `${signingInput}.${base64UrlEncode(signature)}`;
}

function createRuntimeVerifiableE2EJwtFixture({ origin, subjectUserId }) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const kid = `e2e-smoke-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
  const publicJwk = publicKey.export({ format: 'jwk' });
  const now = Math.floor(Date.now() / 1000);
  const token = signJwtRS256(privateKey, kid, {
    iss: origin,
    aud: 'nimi-runtime',
    sub: subjectUserId || 'user-e2e-primary',
    sid: `session-${kid}`,
    iat: now - 30,
    exp: now + 3600,
  });

  return {
    token,
    jwks: {
      keys: [
        {
          ...publicJwk,
          kid,
          use: 'sig',
          alg: 'RS256',
        },
      ],
    },
  };
}

function applicationPath() {
  const bundleRoot = path.join(repoRoot, 'apps/desktop/src-tauri/target/release/bundle/macos');
  if (!fs.existsSync(bundleRoot)) {
    throw new Error(`desktop macOS app bundle not found: ${bundleRoot}`);
  }
  const appEntry = fs.readdirSync(bundleRoot, { withFileTypes: true })
    .find((entry) => entry.isDirectory() && entry.name.endsWith('.app'));
  if (!appEntry) {
    throw new Error(`desktop macOS app bundle is missing under ${bundleRoot}`);
  }
  const macOsDir = path.join(bundleRoot, appEntry.name, 'Contents', 'MacOS');
  const executable = fs.readdirSync(macOsDir, { withFileTypes: true })
    .find((entry) => entry.isFile());
  if (!executable) {
    throw new Error(`desktop macOS bundle executable is missing under ${macOsDir}`);
  }
  return path.join(macOsDir, executable.name);
}

async function spawnLogged(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || repoRoot,
      env: { ...process.env, ...options.env },
      stdio: options.stdio || 'inherit',
      shell: false,
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
      }
    });
  });
}

async function buildApplication() {
  await spawnLogged('pnpm', ['--filter', '@nimiplatform/desktop', 'run', 'prepare:runtime-bundle']);
  await spawnLogged('pnpm', [
    '--filter',
    '@nimiplatform/desktop',
    'exec',
    'tauri',
    'build',
    '--bundles',
    'app',
    '--no-sign',
  ]);
}

function ensureSupportedPlatform() {
  if (os.platform() !== 'darwin') {
    throw new Error('desktop macOS smoke only supports darwin hosts');
  }
}

function createLogFile(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  return fs.createWriteStream(filePath, { flags: 'w' });
}

function makeRunRoot() {
  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const root = path.join(repoRoot, '.local', 'report', 'desktop-macos-smoke', runId);
  fs.mkdirSync(root, { recursive: true });
  return { runId, root };
}

async function waitForFixtureHealth(origin, timeoutMs = 15000) {
  const url = new URL('/__fixture/health', origin).toString();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // keep polling
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`timed out waiting for fixture server ${url}`);
}

async function waitForReport(filePath, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      if (raw.trim()) {
        return JSON.parse(raw);
      }
    } catch {
      // file not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`timed out waiting for smoke report: ${filePath}`);
}

async function waitForBackendLogPattern(filePath, pattern, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      if (pattern.test(raw)) {
        return raw;
      }
    } catch {
      // file not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`timed out waiting for backend log pattern ${pattern}: ${filePath}`);
}

function writeSyntheticFailureReport({
  smokeReportPath,
  scenarioId,
  scenarioManifestPath,
  failedStep,
  failurePhase,
  message,
  backendLogPath,
}) {
  const backendLogPresent = Boolean(backendLogPath && fs.existsSync(backendLogPath));
  writeJson(smokeReportPath, {
    generatedAt: new Date().toISOString(),
    ok: false,
    scenarioId,
    steps: [],
    failedStep,
    errorMessage: message,
    route: null,
    htmlSnapshotPath: null,
    fixtureManifestPath: scenarioManifestPath,
    failureSource: 'runner',
    failurePhase,
    backendLogPath: backendLogPath || null,
    backendLogPresent,
  });
}

function runtimeLockPath() {
  return path.join(os.homedir(), '.nimi', 'runtime', 'runtime.lock');
}

function readRuntimeLockPid() {
  try {
    const raw = fs.readFileSync(runtimeLockPath(), 'utf8').trim();
    const pid = Number.parseInt(raw, 10);
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForProcessExit(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return !isProcessAlive(pid);
}

async function terminatePid(pid, label, timeoutMs = 5000) {
  if (!pid || !isProcessAlive(pid)) {
    return;
  }
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    return;
  }
  if (await waitForProcessExit(pid, timeoutMs)) {
    return;
  }
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    return;
  }
  await waitForProcessExit(pid, 1000);
  if (isProcessAlive(pid)) {
    process.stderr.write(`[desktop-macos-smoke] warning: ${label} pid ${pid} did not exit\n`);
  }
}

async function terminateChildProcess(child, label) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  const closed = new Promise((resolve) => {
    child.once('close', () => resolve(true));
    child.once('exit', () => resolve(true));
  });
  await terminatePid(child.pid, label);
  await Promise.race([
    closed,
    new Promise((resolve) => setTimeout(() => resolve(false), 1000)),
  ]);
}

function closeWriteStream(stream) {
  return new Promise((resolve) => {
    if (!stream || stream.closed || stream.destroyed) {
      resolve();
      return;
    }
    stream.end(resolve);
  });
}

function avatarInstanceIdFromReport(smokeReportPath) {
  try {
    const report = JSON.parse(fs.readFileSync(smokeReportPath, 'utf8'));
    return String(report?.details?.avatarProductPath?.liveInstance?.avatarInstanceId || '').trim();
  } catch {
    return '';
  }
}

async function terminateAvatarProductResidue(smokeReportPath) {
  const avatarInstanceId = avatarInstanceIdFromReport(smokeReportPath);
  if (!avatarInstanceId) {
    return;
  }
  const result = spawnSync('pgrep', ['-f', avatarInstanceId], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  if (result.status !== 0 || !result.stdout.trim()) {
    return;
  }
  const pids = result.stdout
    .split(/\s+/)
    .map((value) => Number.parseInt(value, 10))
    .filter((pid) => Number.isFinite(pid) && pid > 0 && pid !== process.pid);
  for (const pid of pids) {
    await terminatePid(pid, `Avatar product smoke residue ${avatarInstanceId}`);
  }
}

async function terminateRuntimeStartedByScenario(initialRuntimeLockPid) {
  const currentLockPid = readRuntimeLockPid();
  if (!currentLockPid || currentLockPid === initialRuntimeLockPid) {
    return;
  }
  await terminatePid(currentLockPid, 'Runtime product smoke residue');
  const remainingLockPid = readRuntimeLockPid();
  if (remainingLockPid === currentLockPid && !isProcessAlive(currentLockPid)) {
    try {
      fs.unlinkSync(runtimeLockPath());
    } catch {
      // Runtime may have removed the lock between the read and unlink.
    }
  }
}

async function runScenario({ scenarioId, runIndex, runRoot, timeoutMs }) {
  const scenario = scenarioEntryForId(scenarioId);
  if (!scenario) {
    throw new Error(`missing registry entry for ${scenarioId}`);
  }

  const appPath = applicationPath();
  if (!fs.existsSync(appPath)) {
    throw new Error(`desktop macOS smoke application not found: ${appPath}`);
  }

  const artifactsDir = path.join(runRoot, `${String(runIndex).padStart(2, '0')}-${scenarioId}`);
  const backendLogPath = path.join(artifactsDir, 'backend.log');
  const scenarioManifestPath = path.join(artifactsDir, 'scenario-manifest.json');
  const artifactManifestPath = path.join(artifactsDir, 'artifact-manifest.json');
  const smokeReportPath = path.join(artifactsDir, 'macos-smoke-report.json');
  fs.mkdirSync(artifactsDir, { recursive: true });

  const baseProfile = loadProfileDefinition(profilePathForScenario(scenarioId));
  const cubismSample = isDynamicLive2dSampleScenario(scenarioId)
    || scenarioId.startsWith('chat.live2d-render-smoke')
    || scenarioId === LIVE2D_AVATAR_PRODUCT_SMOKE_SCENARIO
    ? ensureCubismLive2dSample(cubismSampleModelForScenario(scenarioId))
    : null;
  const avatarProductLive2dPackage = scenarioId === LIVE2D_AVATAR_PRODUCT_SMOKE_SCENARIO
    ? createAvatarProductSmokeLive2dPackage(artifactsDir, cubismSample)
    : null;
  const profile = applyAvatarProductPresentationProfile(
    baseProfile,
    scenarioId,
    avatarProductLive2dPackage?.presentationProfile || null,
  );
  const cubismProfile = cubismSample
    ? cubismSampleProfileTokensForScenario(scenarioId)
    : null;
  const vrmSampleDefinition = vrmSampleDefinitionForScenario(scenarioId);
  const vrmSample = vrmSampleDefinition
    ? await ensureVrmSample(vrmSampleDefinition)
    : null;
  const tauriFixture = runtimeProductSmokeTauriFixture(profile, scenarioId);
  const avatarProductSmokeLaunchTarget = scenarioId === LIVE2D_AVATAR_PRODUCT_SMOKE_SCENARIO
    ? ensureAvatarProductSmokeLaunchTarget()
    : { appPath: '', binaryPath: '' };
  const disableRuntimeBootstrap = scenarioId !== LIVE2D_AVATAR_PRODUCT_SMOKE_SCENARIO;
  const bootstrapTimeoutMs = scenarioId === LIVE2D_AVATAR_PRODUCT_SMOKE_SCENARIO
    ? LIVE2D_AVATAR_PRODUCT_BOOTSTRAP_TIMEOUT_MS
    : undefined;
  const avatarProductRuntimeStatePath = scenarioId === LIVE2D_AVATAR_PRODUCT_SMOKE_SCENARIO
    ? path.join(artifactsDir, 'runtime', 'local-state.json')
    : '';
  const avatarProductRuntimeConfigPath = scenarioId === LIVE2D_AVATAR_PRODUCT_SMOKE_SCENARIO
    ? path.join(artifactsDir, 'runtime', 'config.json')
    : '';
  const avatarProductSmokeProvider = scenarioId === LIVE2D_AVATAR_PRODUCT_SMOKE_SCENARIO
    ? await startOpenAiCompatibleSmokeProvider()
    : null;
  if (avatarProductRuntimeStatePath) {
    fs.mkdirSync(path.dirname(avatarProductRuntimeStatePath), { recursive: true });
    writeAvatarProductRuntimeLocalState(avatarProductRuntimeStatePath, avatarProductSmokeProvider);
  }
  writeJson(scenarioManifestPath, {
    scenarioId,
    realmFixture: profile.realmFixture || {},
    tauriFixture,
    artifactPolicy: profile.artifactPolicy || {},
  });
  const fixtureServer = await startRealmFixtureServer({ manifestPath: scenarioManifestPath });
  const authUserId = String(profile.realmFixture?.currentUser?.id || 'user-e2e-primary').trim();
  const e2eJwtFixture = scenarioId === LIVE2D_AVATAR_PRODUCT_SMOKE_SCENARIO
    ? createRuntimeVerifiableE2EJwtFixture({
        origin: fixtureServer.origin,
        subjectUserId: authUserId,
      })
    : null;
  const runtimeGrpcAddr = scenarioId === LIVE2D_AVATAR_PRODUCT_SMOKE_SCENARIO
    ? `127.0.0.1:${await findFreeLoopbackPort()}`
    : '';
  const runtimeHttpAddr = scenarioId === LIVE2D_AVATAR_PRODUCT_SMOKE_SCENARIO
    ? `127.0.0.1:${await findFreeLoopbackPort()}`
    : '';
  if (avatarProductRuntimeConfigPath && e2eJwtFixture) {
    writeJson(avatarProductRuntimeConfigPath, {
      schemaVersion: 1,
      grpcAddr: runtimeGrpcAddr,
      httpAddr: runtimeHttpAddr,
      localStatePath: avatarProductRuntimeStatePath,
      auth: {
        jwt: {
          issuer: fixtureServer.origin,
          audience: 'nimi-runtime',
          jwksUrl: new URL('/api/auth/jwks', fixtureServer.origin).toString(),
          revocationUrl: new URL('/api/auth/revocation', fixtureServer.origin).toString(),
        },
      },
    });
  }
  const scenarioManifest = replacePlaceholders({
    ...profile,
    scenarioId,
    realmFixture: {
      ...(profile.realmFixture || {}),
      ...(e2eJwtFixture ? { authJwks: e2eJwtFixture.jwks } : {}),
    },
    tauriFixture: {
      ...tauriFixture,
      macosSmoke: {
        enabled: true,
        scenarioId,
        reportPath: smokeReportPath,
        artifactsDir,
        disableRuntimeBootstrap,
        ...(bootstrapTimeoutMs ? { bootstrapTimeoutMs } : {}),
      },
    },
  }, {
    __FIXTURE_ORIGIN__: fixtureServer.origin,
    __REPO_ROOT__: repoRoot,
    __CUBISM_SAMPLE_LIVE2D_ROOT__: cubismSample?.sampleRoot || '',
    __CUBISM_SAMPLE_LIVE2D_MODEL_FILE_URL__: cubismSample?.modelFileUrl || '',
    __CUBISM_SAMPLE_RESOURCE_ID__: cubismProfile?.resourceId || '',
    __CUBISM_SAMPLE_DISPLAY_NAME__: cubismProfile?.displayName || '',
    __CUBISM_SAMPLE_MODEL_FILENAME__: cubismProfile?.modelFilename || '',
    __VRM_SAMPLE_RESOURCE_ID__: vrmSample?.resourceId || '',
    __VRM_SAMPLE_DISPLAY_NAME__: vrmSample?.displayName || '',
    __VRM_SAMPLE_FILENAME__: vrmSample?.filename || '',
    __VRM_SAMPLE_ROOT__: vrmSample?.sampleRoot || '',
    __VRM_SAMPLE_FILE_URL__: vrmSample?.sampleFileUrl || '',
    __E2E_ACCESS_TOKEN__: e2eJwtFixture?.token || '',
  });
  writeJson(scenarioManifestPath, scenarioManifest);
  writeJson(artifactManifestPath, {
    scenario_id: scenarioId,
    spec_path: scenario.spec,
    suite_bucket: scenario.bucket,
    fixture_profile: path.relative(repoRoot, profilePathForScenario(scenarioId)),
    fixture_manifest: path.relative(repoRoot, scenarioManifestPath),
    backend_log: path.relative(repoRoot, backendLogPath),
    smoke_report: path.relative(repoRoot, smokeReportPath),
    runtime_local_state: avatarProductRuntimeStatePath
      ? path.relative(repoRoot, avatarProductRuntimeStatePath)
      : null,
    runtime_config: avatarProductRuntimeConfigPath
      ? path.relative(repoRoot, avatarProductRuntimeConfigPath)
      : null,
    runtime_grpc_addr: runtimeGrpcAddr || null,
    runtime_http_addr: runtimeHttpAddr || null,
    runtime_text_route_provider: avatarProductSmokeProvider
      ? {
          endpoint: avatarProductSmokeProvider.endpoint,
          model_id: avatarProductSmokeProvider.modelId,
          local_asset_id: 'local-e2e-live2d-text-route',
        }
      : null,
    avatar_product_smoke_app: avatarProductSmokeLaunchTarget.appPath
      ? path.relative(repoRoot, avatarProductSmokeLaunchTarget.appPath)
      : null,
    avatar_product_smoke_binary: avatarProductSmokeLaunchTarget.binaryPath
      ? path.relative(repoRoot, avatarProductSmokeLaunchTarget.binaryPath)
      : null,
    avatar_product_live2d_asset: avatarProductLive2dPackage
      ? {
          package_root: path.relative(repoRoot, avatarProductLive2dPackage.packageRoot),
          runtime_link: path.relative(repoRoot, avatarProductLive2dPackage.runtimeLink),
          source_sample_root: path.relative(repoRoot, cubismSample.sampleRoot),
        }
      : null,
    artifact_policy: scenarioManifest.artifactPolicy || {},
  });

  const backendLog = createLogFile(backendLogPath);
  const initialRuntimeLockPid = readRuntimeLockPid();
  const smokeAuthSessionEnv = scenarioId === LIVE2D_AVATAR_PRODUCT_SMOKE_SCENARIO
    ? {
        NIMI_E2E_AUTH_SESSION_STORAGE: 'encrypted-file',
        NIMI_E2E_AUTH_SESSION_MASTER_KEY: crypto.randomBytes(32).toString('base64'),
      }
    : {};
  const app = spawn(appPath, [], {
    cwd: repoRoot,
    env: {
      ...process.env,
      ...smokeAuthSessionEnv,
      NIMI_RUNTIME_BRIDGE_MODE: 'RELEASE',
      NIMI_REALM_URL: fixtureServer.origin,
      NIMI_E2E_PROFILE: scenarioId,
      NIMI_E2E_FIXTURE_PATH: scenarioManifestPath,
      NIMI_E2E_BACKEND_LOG_PATH: backendLogPath,
      NIMI_DEBUG_BOOT: '1',
      NIMI_VERBOSE_RENDERER_LOGS: '1',
      ...(avatarProductSmokeLaunchTarget.appPath ? { NIMI_AVATAR_APP_PATH: avatarProductSmokeLaunchTarget.appPath } : {}),
      ...(avatarProductSmokeLaunchTarget.binaryPath ? { NIMI_AVATAR_BINARY_PATH: avatarProductSmokeLaunchTarget.binaryPath } : {}),
      ...(avatarProductRuntimeStatePath ? {
        NIMI_RUNTIME_LOCAL_STATE_PATH: avatarProductRuntimeStatePath,
        NIMI_RUNTIME_CONFIG_PATH: avatarProductRuntimeConfigPath,
        NIMI_RUNTIME_GRPC_ADDR: runtimeGrpcAddr,
        NIMI_RUNTIME_HTTP_ADDR: runtimeHttpAddr,
        NIMI_RUNTIME_BRIDGE_DEBUG: '1',
      } : {}),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  app.stdout.pipe(backendLog);
  app.stderr.pipe(backendLog);

  try {
    await waitForFixtureHealth(fixtureServer.origin);
    try {
      await waitForBackendLogPattern(
        backendLogPath,
        /setup found main window/,
        20000,
      );
    } catch (error) {
      writeSyntheticFailureReport({
        smokeReportPath,
        scenarioId,
        scenarioManifestPath,
        failedStep: 'runner-no-main-window',
        failurePhase: 'bundle_launch',
        message: error instanceof Error ? error.message : String(error || 'unknown error'),
        backendLogPath,
      });
      throw error;
    }
    try {
      await waitForBackendLogPattern(
        backendLogPath,
        /macos_smoke_ping stage=(window-eval-probe|renderer-main-entry|renderer-root-mounted|app-mounted|macos-smoke-context-ready|window-page-error)/,
        20000,
      );
    } catch (error) {
      writeSyntheticFailureReport({
        smokeReportPath,
        scenarioId,
        scenarioManifestPath,
        failedStep: 'runner-no-renderer-ping',
        failurePhase: 'renderer_boot',
        message: error instanceof Error ? error.message : String(error || 'unknown error'),
        backendLogPath,
      });
      throw error;
    }
    let report;
    try {
      report = await waitForReport(smokeReportPath, timeoutMs);
    } catch (error) {
      writeSyntheticFailureReport({
        smokeReportPath,
        scenarioId,
        scenarioManifestPath,
        failedStep: 'runner-no-smoke-report-after-renderer-ping',
        failurePhase: 'scenario_report',
        message: error instanceof Error ? error.message : String(error || 'unknown error'),
        backendLogPath,
      });
      throw error;
    }
    if (report?.ok !== true) {
      throw new Error(report?.errorMessage || `macOS smoke scenario failed: ${scenarioId}`);
    }
  } finally {
    await terminateChildProcess(app, 'Desktop macOS smoke app');
    await terminateAvatarProductResidue(smokeReportPath);
    await terminateRuntimeStartedByScenario(initialRuntimeLockPid);
    await closeWriteStream(backendLog);
    await fixtureServer.close();
    if (avatarProductSmokeProvider) {
      await avatarProductSmokeProvider.close();
    }
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  ensureSupportedPlatform();
  const selectedScenarios = selectScenarios(options);
  if (!options.skipBuild) {
    await buildApplication();
  }
  const run = makeRunRoot();
  let runIndex = 0;
  for (const scenarioId of selectedScenarios) {
    runIndex += 1;
    await runScenario({
      scenarioId,
      runIndex,
      runRoot: run.root,
      timeoutMs: options.timeoutMs,
    });
  }
  process.stdout.write(`[desktop-macos-smoke] wrote ${path.relative(repoRoot, run.root)}\n`);
}

main().catch((error) => {
  process.stderr.write(`[desktop-macos-smoke] failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
