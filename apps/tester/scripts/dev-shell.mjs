import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { Runtime, AppMode, WorldRelation } from '@nimiplatform/sdk/runtime';

const APP_INSTANCE_SUFFIX = '.developer-local';
const DEVICE_ID = 'developer-local-device';
const DEFAULT_TTL_SECONDS = 3600;

function readYamlScalar(text, key) {
  const match = text.match(new RegExp(`^${key}:\\s*(.+?)\\s*$`, "m"));
  return match ? match[1].trim() : '';
}

function readAppIdentity() {
  const manifest = readFileSync(new URL('../nimi.app.yaml', import.meta.url), 'utf8');
  const appId = readYamlScalar(manifest, 'app_id');
  const displayName = readYamlScalar(manifest, 'display_name') || appId;
  if (!appId) {
    throw new Error('app_id missing from nimi.app.yaml');
  }
  return { appId, displayName };
}

function reasonLabel(response) {
  return String(response?.reasonCode || 'unknown');
}

async function openDeveloperSession(identity) {
  const appInstanceId = `${identity.appId}${APP_INSTANCE_SUFFIX}`;
  const subjectUserId = String(process.env.NIMI_RUNTIME_DEVELOPER_SUBJECT || 'developer-local').trim() || 'developer-local';
  const ttlSecondsInput = Number(process.env.NIMI_RUNTIME_DEVELOPER_SESSION_TTL_SECONDS || DEFAULT_TTL_SECONDS);
  const ttlSeconds = Number.isFinite(ttlSecondsInput) && ttlSecondsInput > 0 ? ttlSecondsInput : DEFAULT_TTL_SECONDS;
  const runtime = new Runtime({
    appId: identity.appId,
    defaults: {
      appInstanceId,
      callerKind: 'third-party-app',
      callerId: identity.appId,
    },
  });

  const registered = await runtime.auth.registerApp({
    appId: identity.appId,
    appInstanceId,
    deviceId: DEVICE_ID,
    appVersion: '0.1.0-dev',
    capabilities: [],
    modeManifest: {
      appMode: AppMode.FULL,
      runtimeRequired: true,
      realmRequired: true,
      worldRelation: WorldRelation.NONE,
    },
  });

  if (!registered.accepted) {
    throw new Error([
      `Runtime rejected developer app registration: ${reasonLabel(registered)}`,
      identity.appId.startsWith('nimi.')
        ? 'The nimi.* namespace is platform-governed; use a non-reserved app id for third-party local development unless this app is present in the Runtime registry.'
        : 'Check that the local Runtime daemon is running and Developer Mode/local app trust is allowed for this app id.',
    ].join(' '));
  }

  const session = await runtime.auth.openSession({
    appId: identity.appId,
    appInstanceId,
    deviceId: DEVICE_ID,
    subjectUserId,
    ttlSeconds,
  });

  if (!session.sessionId || !session.sessionToken) {
    throw new Error(`Runtime did not issue developer app session: ${reasonLabel(session)}`);
  }

  return {
    sessionId: session.sessionId,
    sessionToken: session.sessionToken,
  };
}

function runTauriDev(identity, session) {
  const child = spawn('pnpm', ['exec', 'tauri', 'dev'], {
    stdio: 'inherit',
    env: {
      ...process.env,
      VITE_NIMI_APP_AUTH_MODE: 'dev-standalone',
      VITE_NIMI_RUNTIME_DEVELOPER_SESSION_ID: session.sessionId,
      VITE_NIMI_RUNTIME_DEVELOPER_SESSION_TOKEN: session.sessionToken,
    },
  });

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });

  child.on('error', (error) => {
    process.stderr.write(`[nimi-app] failed to launch Tauri dev shell for ${identity.displayName}: ${error.message}\n`);
    process.exit(1);
  });
}

try {
  const identity = readAppIdentity();
  const session = await openDeveloperSession(identity);
  process.stdout.write(`[nimi-app] Runtime developer session ready for ${identity.appId}\n`);
  runTauriDev(identity, session);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error || 'unknown error');
  process.stderr.write(`[nimi-app] dev shell failed: ${message}\n`);
  process.exit(1);
}
