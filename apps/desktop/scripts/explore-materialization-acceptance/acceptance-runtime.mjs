import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  createNimiDesktopShellRuntimeAccountCaller,
  createNimiRuntimeAgentClient,
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
} from '@nimiplatform/sdk/runtime/generated';
import {
  APP_ID,
  OWNER_USER_ID,
  PROTECTED_SCOPES,
} from './acceptance-constants.mjs';
import {
  allocatePort,
  delay,
  formatError,
} from './acceptance-files.mjs';

export async function startRuntimeDaemon({ fixtureOrigin, homeDir, stateRoot, runtimeDir, baseEnv, runtimeConfigPath, stdoutPath, stderrPath }) {
  const grpcPort = await allocatePort();
  const httpPort = await allocatePort();
  const endpoint = `127.0.0.1:${grpcPort}`;
  const httpEndpoint = `127.0.0.1:${httpPort}`;
  const localStatePath = path.join(stateRoot, 'local-state.json');
  const modelRegistryPath = path.join(stateRoot, 'model-registry.json');
  const daemon = spawn('go', ['run', './cmd/nimi', 'serve'], {
    cwd: runtimeDir,
    detached: true,
    env: {
      ...baseEnv,
      HOME: homeDir,
      USERPROFILE: homeDir,
      NIMI_REALM_URL: fixtureOrigin,
      NIMI_RUNTIME_GRPC_ADDR: endpoint,
      NIMI_RUNTIME_HTTP_ADDR: httpEndpoint,
      NIMI_RUNTIME_ENABLE_WORKERS: '0',
      NIMI_RUNTIME_LOCK_PATH: path.join(stateRoot, 'runtime.lock'),
      NIMI_RUNTIME_CONFIG_PATH: runtimeConfigPath,
      NIMI_RUNTIME_MODEL_REGISTRY_PATH: modelRegistryPath,
      NIMI_RUNTIME_LOCAL_STATE_PATH: localStatePath,
      NIMI_RUNTIME_CONNECTOR_STORE_PATH: path.join(stateRoot, 'connector-store.json'),
      NIMI_RUNTIME_AUTH_DEVELOPER_REGISTRATION_ENABLED: '1',
      NIMI_RUNTIME_ACCOUNT_REALM_BASE_URL: fixtureOrigin,
      NIMI_RUNTIME_ACCOUNT_AUTHORIZATION_URL: `${fixtureOrigin}/api/auth/oauth/authorize`,
      NIMI_RUNTIME_ACCOUNT_TOKEN_URL: `${fixtureOrigin}/api/auth/oauth/token`,
      NIMI_RUNTIME_ACCOUNT_CUSTODY_PARTITION: `desktop-explore-materialization-${process.pid}-${Date.now()}`,
      XDG_DATA_HOME: path.join(stateRoot, 'xdg-data'),
      XDG_CACHE_HOME: path.join(stateRoot, 'xdg-cache'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  daemon.stdout.pipe(fs.createWriteStream(stdoutPath));
  daemon.stderr.pipe(fs.createWriteStream(stderrPath));
  await waitForRuntimeReady(endpoint, daemon);
  return {
    daemon,
    endpoint,
    httpEndpoint,
    localStatePath,
    modelRegistryPath,
  };
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

export async function completeRuntimeAccountLogin(runtime, observationsLog) {
  const caller = createNimiDesktopShellRuntimeAccountCaller({ appId: APP_ID });
  observationsLog.runtimeAccount = { stage: 'registering_app' };
  await createNimiRuntimeFullAppRegistration(
    () => ({ auth: runtime.auth }),
    {
      appId: APP_ID,
      appInstanceId: caller.appInstanceId,
      deviceId: caller.deviceId,
      appVersion: 'desktop-explore-materialization-acceptance',
      capabilities: PROTECTED_SCOPES,
      developerRegistration: false,
    },
  )();
  observationsLog.runtimeAccount = { stage: 'begin_login' };
  const begin = await runtime.account.beginLogin({
    caller,
    redirectUri: 'http://localhost:46373/oauth/callback',
    callbackOrigin: '',
    ttlSeconds: 300,
  }, idempotency(`account-begin:${caller.appInstanceId}`));
  if (!begin.accepted || !begin.loginAttemptId) {
    throw new Error(`Runtime beginLogin rejected: ${JSON.stringify(begin)}`);
  }
  observationsLog.runtimeAccount = { stage: 'complete_login', loginAttemptId: begin.loginAttemptId };
  const complete = await runtime.account.completeLogin({
    caller,
    loginAttemptId: begin.loginAttemptId,
    code: 'runtime-live-auth-code',
    state: begin.state,
    nonce: begin.nonce,
    redirectUri: 'http://localhost:46373/oauth/callback',
    sealedCompletionTicket: '',
    refreshToken: '',
  }, idempotency(`account-complete:${begin.loginAttemptId}`));
  if (!complete.accepted) {
    throw new Error(`Runtime completeLogin rejected: ${JSON.stringify(complete)}`);
  }
  observationsLog.runtimeAccount = { stage: 'status', accountId: complete.accountProjection?.accountId || '' };
  const status = await runtime.account.getAccountSessionStatus(
    { caller },
    idempotency(`account-status:${caller.appInstanceId}`),
  );
  if (status.state !== AccountSessionState.AUTHENTICATED || status.accountProjection?.accountId !== OWNER_USER_ID) {
    throw new Error(`Runtime account is not authenticated as ${OWNER_USER_ID}: ${JSON.stringify(status)}`);
  }
  observationsLog.runtimeAccount = { stage: 'access_token', accountId: status.accountProjection?.accountId || '' };
  const token = await runtime.account.getAccessToken(
    { caller, requestedScopes: [] },
    idempotency(`account-token:${caller.appInstanceId}`),
  );
  if (!token.accepted || !token.accessToken) {
    throw new Error(`Runtime account token unavailable: ${JSON.stringify(token)}`);
  }
  observationsLog.runtimeAccount = {
    stage: 'authenticated',
    accountId: status.accountProjection?.accountId || '',
    tokenAvailable: true,
  };
}

export async function prepareRuntimeProductControl(runtime, dataRoot) {
  const baseCallOptions = { metadata: { surfaceId: 'desktop.explore-materialization.acceptance' } };
  const readOptions = { callOptions: baseCallOptions };
  const initial = await getNimiRuntimeProductControlRecord(runtime.generated, readOptions);
  if (initial.state === 'ready_for_use') {
    return initial;
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

export function createAcceptanceAgentClient(runtime) {
  const sessionMetadata = createNimiRuntimeAppSessionMetadataProvider({
    appId: APP_ID,
    appInstanceId: `${APP_ID}.acceptance-agent-session`,
    deviceId: 'acceptance-agent-session',
    appVersion: 'desktop-explore-materialization-acceptance',
    capabilities: PROTECTED_SCOPES,
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
  return createNimiRuntimeAgentClient({
    runtime: agentRuntime,
    appId: APP_ID,
    getSubjectUserId: () => OWNER_USER_ID,
    withScopes: (scopes, operation) =>
      withNimiRuntimeAgentScopes({
        runtime: agentRuntime,
        subjectUserId: OWNER_USER_ID,
      }, scopes, async (options) => {
        const metadata = await sessionMetadata();
        return operation(idempotency(`agent:${scopes.join(',')}`, {
          ...options,
          metadata: {
            ...metadata,
            ...(options.metadata ?? {}),
          },
        }));
      }),
  });
}

function idempotency(key, options) {
  return withNimiRuntimeIdempotencyMetadata(options, `desktop-explore-materialization-acceptance:${key}`);
}
