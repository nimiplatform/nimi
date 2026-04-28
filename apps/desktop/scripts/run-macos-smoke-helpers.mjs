import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import process from 'node:process';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
export const desktopRoot = path.resolve(scriptDir, '..');
export const repoRoot = path.resolve(desktopRoot, '..', '..');
export const CUBISM_WEB_SDK_VERSION = '5-r.5';
export const DEFAULT_CUBISM_SAMPLE_MODEL = 'Hiyori';
export const LIVE2D_SMOKE_SCENARIO_PREFIX = 'chat.live2d-render-smoke-';
export const LIVE2D_AVATAR_PRODUCT_SMOKE_SCENARIO = 'chat.live2d-avatar-product-smoke';
export const LIVE2D_AVATAR_PRODUCT_BOOTSTRAP_TIMEOUT_MS = 120000;
export const VRM_SAMPLE_CATALOG = {
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

export function ensureCubismLive2dSample(modelName = DEFAULT_CUBISM_SAMPLE_MODEL) {
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

export function vrmSampleDefinitionForScenario(scenarioId) {
  return VRM_SAMPLE_CATALOG[scenarioId] || null;
}

export function runChecked(command, args, options = {}) {
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

export async function ensureVrmSample(sampleDefinition) {
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

export function cubismSampleModelForScenario(scenarioId) {
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

export function cubismSampleProfileTokensForScenario(scenarioId) {
  const modelName = cubismSampleModelForScenario(scenarioId);
  return {
    resourceId: `fixture-live2d-${modelName.toLowerCase()}`,
    displayName: `Fixture ${modelName} Live2D`,
    modelFilename: `${modelName}.model3.json`,
  };
}

export function parseArgs(argv) {
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

export function mergeDeep(baseValue, overrideValue) {
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

export function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

export function loadProfileDefinition(filePath, seen = new Set()) {
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

export function replacePlaceholders(value, replacements) {
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

export function runtimeProductSmokeTauriFixture(profile, scenarioId) {
  const fixture = {
    ...(profile.tauriFixture || {}),
  };
  if (scenarioId === LIVE2D_AVATAR_PRODUCT_SMOKE_SCENARIO) {
    delete fixture.runtimeBridgeStatus;
    delete fixture.desktopReleaseInfo;
  }
  return fixture;
}

export function cloneJson(value) {
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

export function withAgentPresentationProfile(agent, presentationProfile) {
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

export function applyAvatarProductPresentationProfile(profile, scenarioId, presentationProfile) {
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

export function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export function escapeXmlText(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export async function findFreeLoopbackPort() {
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

export async function startOpenAiCompatibleSmokeProvider() {
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

export function writeAvatarProductRuntimeLocalState(statePath, provider) {
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

export function base64UrlEncode(value) {
  return Buffer.from(value)
    .toString('base64')
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '');
}

export function signJwtRS256(privateKey, kid, claims) {
  const header = {
    alg: 'RS256',
    typ: 'JWT',
    kid,
  };
  const signingInput = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(claims))}`;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(signingInput), privateKey);
  return `${signingInput}.${base64UrlEncode(signature)}`;
}

export function createRuntimeVerifiableE2EJwtFixture({ origin, subjectUserId }) {
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

export * from './run-macos-smoke-process.mjs';
