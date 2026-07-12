import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  createNimiDesktopShellRuntimeAccountCaller,
  createNimiRuntimeAgentClient,
  createNimiHostRuntimeAgentInspectSurface,
  createNimiRuntimeAppSessionMetadataProvider,
  createNimiRuntimeFullAppRegistration,
  createRuntime,
  getNimiRuntimeProductControlRecord,
  ensureNimiRuntimeProductControlRecordCreated,
  selectNimiRuntimeProductControlDataRoot,
  setNimiRuntimeProductControlFirstRunInstallLevel,
  completeNimiRuntimeProductControlFirstRunDeviceEnvironmentScan,
  withNimiRuntimeAgentScopes,
  withNimiRuntimeIdempotencyMetadata,
} from '@nimiplatform/sdk/runtime';
import {
  AccountSessionState,
  LocalAssetKind,
  LocalAssetStatus,
} from '@nimiplatform/sdk/runtime/wire-types';
import {
  APP_ID,
  OWNER_USER_ID,
  REGISTRATION_CAPABILITIES,
} from './acceptance-constants.mjs';
import {
  allocatePort,
  delay,
  formatError,
} from './acceptance-files.mjs';

export async function startRuntimeDaemon({ fixtureOrigin, realmIssuerOrigin = fixtureOrigin, providerOrigin = fixtureOrigin, homeDir, stateRoot, runtimeDir, baseEnv, runtimeConfigPath, stdoutPath, stderrPath, grpcPort: requestedGrpcPort = null, httpPort: requestedHttpPort = null, appendLogs = false }) {
  const grpcPort = requestedGrpcPort || await allocatePort();
  const httpPort = requestedHttpPort || await allocatePort();
  const endpoint = `127.0.0.1:${grpcPort}`;
  const httpEndpoint = `127.0.0.1:${httpPort}`;
  const repoRoot = path.resolve(runtimeDir, '..');
  const goBuildEnvironment = resolveHostGoBuildEnvironment(baseEnv, repoRoot);
  const localStatePath = path.join(stateRoot, 'local-state.json');
  const modelRegistryPath = path.join(stateRoot, 'model-registry.json');
  const daemon = spawn('go', ['run', './cmd/nimi', 'serve'], {
    cwd: runtimeDir,
    detached: true,
    env: {
      ...baseEnv,
      HOME: homeDir,
      USERPROFILE: homeDir,
      GOCACHE: goBuildEnvironment.GOCACHE,
      GOMODCACHE: goBuildEnvironment.GOMODCACHE,
      GOPATH: goBuildEnvironment.GOPATH,
      NIMI_REALM_URL: fixtureOrigin,
      NIMI_RUNTIME_GRPC_ADDR: endpoint,
      NIMI_RUNTIME_HTTP_ADDR: httpEndpoint,
      NIMI_RUNTIME_ENABLE_WORKERS: '0',
      NIMI_RUNTIME_LOCK_PATH: path.join(stateRoot, 'runtime.lock'),
      NIMI_RUNTIME_CONFIG_PATH: runtimeConfigPath,
      NIMI_RUNTIME_MODEL_REGISTRY_PATH: modelRegistryPath,
      NIMI_RUNTIME_MODEL_CATALOG_CUSTOM_DIR: path.join(stateRoot, 'model-catalog-custom'),
      NIMI_RUNTIME_DEFAULT_LOCAL_TEXT_MODEL: 'runtime-agent-live-e2e',
      NIMI_RUNTIME_ENGINE_LLAMA_ENABLED: '0',
      NIMI_RUNTIME_LOCAL_LLAMA_BASE_URL: `${providerOrigin}/v1`,
      NIMI_RUNTIME_ALLOW_LOOPBACK_PROVIDER_ENDPOINT: '1',
      NIMI_RUNTIME_LOCAL_STATE_PATH: localStatePath,
      NIMI_RUNTIME_CONNECTOR_STORE_PATH: path.join(stateRoot, 'connector-store.json'),
      NIMI_RUNTIME_CONNECTOR_TEST_MEMORY_SECRETS: '1',
      NIMI_RUNTIME_ACCOUNT_TEST_CUSTODY_FILE_PATH: path.join(stateRoot, 'account-custody.json'),
      NIMI_RUNTIME_AUTH_DEVELOPER_REGISTRATION_ENABLED: '1',
      NIMI_RUNTIME_APP_REGISTRY_PATH: path.join(repoRoot, '.nimi', 'spec', 'platform', 'kernel', 'tables', 'nimi-app-registry.yaml'),
      NIMI_RUNTIME_AUTH_JWT_ISSUER: realmIssuerOrigin,
      NIMI_RUNTIME_AUTH_JWT_AUDIENCE: 'nimi-runtime',
      NIMI_RUNTIME_AUTH_JWT_JWKS_URL: `${fixtureOrigin}/api/auth/jwks`,
      NIMI_RUNTIME_AUTH_JWT_REVOCATION_URL: `${fixtureOrigin}/api/auth/sessions/introspect`,
      NIMI_RUNTIME_ACCOUNT_REALM_BASE_URL: fixtureOrigin,
      NIMI_RUNTIME_ACCOUNT_AUTHORIZATION_URL: `${fixtureOrigin}/api/auth/oauth/authorize`,
      NIMI_RUNTIME_ACCOUNT_TOKEN_URL: `${fixtureOrigin}/api/auth/oauth/token`,
      NIMI_RUNTIME_ACCOUNT_CUSTODY_PARTITION: `desktop-explore-materialization-${process.pid}-${Date.now()}`,
      XDG_DATA_HOME: path.join(stateRoot, 'xdg-data'),
      XDG_CACHE_HOME: path.join(stateRoot, 'xdg-cache'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  daemon.stdout.pipe(fs.createWriteStream(stdoutPath, { flags: appendLogs ? 'a' : 'w' }));
  daemon.stderr.pipe(fs.createWriteStream(stderrPath, { flags: appendLogs ? 'a' : 'w' }));
  // Recorded so a later gate run can locate and terminate a daemon orphaned by a
  // hard harness crash (see tests/local-agent-product/harness/sandbox-hygiene.mjs).
  fs.appendFileSync(path.join(stateRoot, 'runtime-daemon.pid'), `${daemon.pid}\n`);
  await waitForRuntimeReady(endpoint, daemon);
  return {
    daemon,
    endpoint,
    httpEndpoint,
    localStatePath,
    modelRegistryPath,
    grpcPort,
    httpPort,
  };
}

let cachedHostGoBuildEnvironment = null;

function resolveHostGoBuildEnvironment(baseEnv, repoRoot) {
  if (cachedHostGoBuildEnvironment) return cachedHostGoBuildEnvironment;
  const explicit = {
    GOCACHE: String(baseEnv?.GOCACHE || '').trim(),
    GOMODCACHE: String(baseEnv?.GOMODCACHE || '').trim(),
    GOPATH: String(baseEnv?.GOPATH || '').trim(),
  };
  if (Object.values(explicit).every(Boolean)) {
    cachedHostGoBuildEnvironment = explicit;
    return cachedHostGoBuildEnvironment;
  }
  const resolved = spawnSync('go', ['env', '-json', 'GOCACHE', 'GOMODCACHE', 'GOPATH'], {
    cwd: repoRoot,
    env: baseEnv,
    encoding: 'utf8',
  });
  if (resolved.status !== 0) {
    throw new Error(`failed to resolve host Go build caches: ${resolved.stderr || resolved.stdout || resolved.error || 'unknown error'}`);
  }
  const discovered = JSON.parse(resolved.stdout || '{}');
  cachedHostGoBuildEnvironment = {
    GOCACHE: explicit.GOCACHE || String(discovered.GOCACHE || path.join(repoRoot, '.cache', 'go-build')),
    GOMODCACHE: explicit.GOMODCACHE || String(discovered.GOMODCACHE || path.join(repoRoot, '.cache', 'go-mod')),
    GOPATH: explicit.GOPATH || String(discovered.GOPATH || path.join(repoRoot, '.cache', 'go-path')),
  };
  return cachedHostGoBuildEnvironment;
}

async function waitForRuntimeReady(endpoint, daemon) {
  const runtime = createRuntime({
    appId: APP_ID,
    transport: { type: 'node-grpc', endpoint },
  });
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < 120_000) {
    if (daemon.exitCode !== null) {
      throw new Error(`Runtime daemon exited early with code ${daemon.exitCode}`);
    }
    try {
      await runtime.local.listLocalAssets({
        statusFilter: LocalAssetStatus.UNSPECIFIED,
        kindFilter: LocalAssetKind.UNSPECIFIED,
        engineFilter: '',
        pageSize: 1,
        pageToken: '',
      }, { timeoutMs: 1000 });
      return;
    } catch (error) {
      lastError = error;
      await delay(250);
    }
  }
  throw new Error(`Runtime readiness timed out: ${formatError(lastError)}`);
}

export async function completeRuntimeAccountLogin(runtime, observationsLog, realRealmSession = null) {
  const caller = createNimiDesktopShellRuntimeAccountCaller({ appId: APP_ID });
  const attemptNonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  observationsLog.runtimeAccount = { stage: 'registering_app' };
  await createNimiRuntimeFullAppRegistration(
    () => ({ auth: runtime.auth }),
    {
      appId: APP_ID,
      appInstanceId: caller.appInstanceId,
      deviceId: caller.deviceId,
      appVersion: 'desktop-explore-materialization-acceptance',
      capabilities: REGISTRATION_CAPABILITIES,
      developerRegistration: false,
    },
  )();
  const sessionMetadata = await createNimiRuntimeAppSessionMetadataProvider({
    appId: APP_ID,
    appInstanceId: caller.appInstanceId,
    deviceId: caller.deviceId,
    appVersion: 'desktop-explore-materialization-acceptance',
    capabilities: REGISTRATION_CAPABILITIES,
    developerRegistration: false,
    auth: runtime.auth,
  })();
  const accountControlMetadata = {
    ...sessionMetadata,
    'x-nimi-source-host': 'desktop-electron-account-host',
    'x-nimi-app-id': caller.appId,
    'x-nimi-app-instance-id': caller.appInstanceId,
    'x-nimi-device-id': caller.deviceId,
  };
  const accountOptions = (key) => idempotency(key, { metadata: accountControlMetadata });
  observationsLog.runtimeAccount = { stage: 'begin_login' };
  const begin = await runtime.account.beginLogin({
    caller,
    redirectUri: 'http://localhost:46373/oauth/callback',
    callbackOrigin: '',
    ttlSeconds: 300,
  }, accountOptions(`account-begin:${caller.appInstanceId}:${attemptNonce}`));
  if (!begin.accepted || !begin.loginAttemptId) {
    throw new Error(`Runtime beginLogin rejected: ${JSON.stringify(begin)}`);
  }
  let authorizationCode = 'runtime-live-auth-code';
  if (realRealmSession) {
    const authorization = await fetch(begin.oauthAuthorizationUrl, {
      headers: { cookie: realRealmSession.cookie },
      redirect: 'manual',
    });
    const location = authorization.headers.get('location');
    if (authorization.status !== 302 || !location) {
      const reason = await (async () => {
        try {
          const text = await authorization.text();
          try {
            const body = JSON.parse(text);
            return String(body?.reasonCode || body?.code || body?.message || 'unknown').slice(0, 160);
          } catch {
            return text.replace(/[A-Za-z0-9._~-]{24,}/gu, '<redacted>').replace(/\s+/gu, ' ').slice(0, 160) || 'unknown';
          }
        } catch {
          return 'unreadable_error_body';
        }
      })();
      throw new Error(`real Realm OAuth authorization did not return a callback (status=${authorization.status}, location=${location ? new URL(location, realRealmSession.realmBaseUrl).pathname : 'missing'}, reason=${reason})`);
    }
    const callback = new URL(location, realRealmSession.realmBaseUrl);
    authorizationCode = callback.searchParams.get('code') || '';
    if (!authorizationCode || callback.searchParams.get('state') !== begin.state) {
      throw new Error('real Realm OAuth callback did not preserve the Runtime login attempt');
    }
  }
  observationsLog.runtimeAccount = { stage: 'complete_login', loginAttemptId: begin.loginAttemptId };
  const complete = await runtime.account.completeLogin({
    caller,
    loginAttemptId: begin.loginAttemptId,
    code: authorizationCode,
    state: begin.state,
    nonce: begin.nonce,
    redirectUri: 'http://localhost:46373/oauth/callback',
    sealedCompletionTicket: '',
    refreshToken: '',
  }, accountOptions(`account-complete:${begin.loginAttemptId}:${attemptNonce}`));
  if (!complete.accepted) {
    throw new Error(`Runtime completeLogin rejected: ${JSON.stringify(complete)}`);
  }
  observationsLog.runtimeAccount = { stage: 'status', accountId: complete.accountProjection?.accountId || '' };
  const status = await runtime.account.getAccountSessionStatus(
    { caller },
    accountOptions(`account-status:${caller.appInstanceId}:${attemptNonce}`),
  );
  const expectedAccountId = realRealmSession?.accountId || OWNER_USER_ID;
  if (status.state !== AccountSessionState.AUTHENTICATED || status.accountProjection?.accountId !== expectedAccountId) {
    throw new Error(`Runtime account is not authenticated as the product trial account: ${JSON.stringify(status)}`);
  }
  observationsLog.runtimeAccount = {
    stage: 'authenticated',
    accountId: status.accountProjection?.accountId || '',
    authCustody: 'runtime-account-service',
    tokenProjected: false,
  };
}

export async function prepareRuntimeProductControl(runtime, dataRoot) {
  const baseCallOptions = { metadata: { surfaceId: 'desktop.explore-materialization.acceptance' } };
  const readOptions = { callOptions: baseCallOptions };
  const initial = await getNimiRuntimeProductControlRecord(runtime.generated, readOptions);
  if (initial.state === 'ready_for_use') {
    return initial;
  }
  if (process.env.NIMI_LOCAL_AGENT_PRODUCT_RUNTIME_DATA_ROOT) {
    throw new Error(`isolated product-control seed failed Runtime owner verification: ${JSON.stringify(initial)}`);
  }
  const writeOptions = (key) => ({
    callOptions: withNimiRuntimeIdempotencyMetadata(baseCallOptions, `explore-materialization:${key}`),
  });
  await ensureNimiRuntimeProductControlRecordCreated(runtime.generated, writeOptions('product-control-ensure'));
  await selectNimiRuntimeProductControlDataRoot(
    runtime.generated,
    { dataRoot },
    writeOptions('product-control-data-root'),
  );
  await setNimiRuntimeProductControlFirstRunInstallLevel(
    runtime.generated,
    { installLevel: 'minimal', aiProfileAlias: 'local-speech-ready' },
    writeOptions('product-control-install-level'),
  );
  await completeNimiRuntimeProductControlFirstRunDeviceEnvironmentScan(
    runtime.generated,
    writeOptions('product-control-device-scan'),
  ).catch(() => undefined);
  return getNimiRuntimeProductControlRecord(runtime.generated, readOptions);
}

export function createAcceptanceAgentClient(runtime, ownerUserId = OWNER_USER_ID) {
  let agentCallIndex = 0;
  const sessionMetadata = createNimiRuntimeAppSessionMetadataProvider({
    appId: APP_ID,
    appInstanceId: `${APP_ID}.acceptance-agent-session`,
    deviceId: 'acceptance-agent-session',
    appVersion: 'desktop-explore-materialization-acceptance',
    capabilities: REGISTRATION_CAPABILITIES,
    developerRegistration: false,
    auth: runtime.auth,
  });
  const agentRuntime = {
    appId: APP_ID,
    auth: runtime.auth,
    appAuth: runtime.grants,
    agents: runtime.agents,
    appMessages: runtime.appMessages,
  };
  const withScopes = (scopes, operation) =>
    withNimiRuntimeAgentScopes({
      runtime: agentRuntime,
      subjectUserId: ownerUserId,
    }, scopes, async (options) => {
      const metadata = await sessionMetadata();
      agentCallIndex += 1;
      return operation(idempotency(`agent:${scopes.join(',')}:${agentCallIndex}`, {
        ...options,
        metadata: {
          ...metadata,
          ...(options.metadata ?? {}),
        },
      }));
    });
  const client = createNimiRuntimeAgentClient({
    runtime: agentRuntime,
    appId: APP_ID,
    getSubjectUserId: () => ownerUserId,
    withScopes,
  });
  const inspect = createNimiHostRuntimeAgentInspectSurface({
    getRuntime: () => ({ ...agentRuntime, agent: runtime.agents }),
    getSubjectUserId: () => ownerUserId,
    withScopes,
  });
  return Object.assign(client, {
    inspect,
  });
}

function idempotency(key, options) {
  return withNimiRuntimeIdempotencyMetadata(options, `desktop-explore-materialization-acceptance:${key}`);
}
