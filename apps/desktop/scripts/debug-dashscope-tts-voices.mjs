/* global console, process, setTimeout, URL */

import net from 'node:net';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createPlatformClient } from '@nimiplatform/sdk';

const APP_ID = 'nimi.desktop.debug.dashscope-tts-voices';
const SUBJECT_USER_ID = 'desktop-debug-user';
const DEFAULT_MODEL = 'qwen3-tts-instruct-flash-2026-01-26';
const DEFAULT_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';

function normalizeModelForCloudRoute(value) {
  const normalized = String(value || '').trim();
  if (!normalized) return `cloud/${DEFAULT_MODEL}`;
  const lower = normalized.toLowerCase();
  if (lower.startsWith('cloud/')) return normalized;
  if (lower.startsWith('local/')) return `cloud/${normalized.slice('local/'.length).trim() || DEFAULT_MODEL}`;
  if (lower.startsWith('token/')) return `cloud/${normalized.slice('token/'.length).trim() || DEFAULT_MODEL}`;
  return `cloud/${normalized}`;
}

async function allocatePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('failed to allocate port'));
        return;
      }
      const port = address.port;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
    server.on('error', reject);
  });
}

async function waitForRuntimeReady(runtime) {
  let lastError = null;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      await runtime.local.listLocalModels({});
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error(`runtime readiness check failed: ${String(lastError)}`);
}

async function terminateDaemon(daemon) {
  const killGroup = (signal) => {
    if (daemon.pid === undefined) {
      return;
    }
    try {
      process.kill(-daemon.pid, signal);
    } catch {
      // Ignore when process group is already gone.
    }
    try {
      process.kill(daemon.pid, signal);
    } catch {
      // Ignore when process is already gone.
    }
  };

  killGroup('SIGTERM');
  const settled = await Promise.race([
    once(daemon, 'exit'),
    new Promise((resolve) => setTimeout(() => resolve('timeout'), 8_000)),
  ]);
  if (settled === 'timeout') {
    killGroup('SIGKILL');
  }
}

async function main() {
  const apiKey = String(process.env.NIMI_DASHSCOPE_API_KEY || process.env.DASHSCOPE_API_KEY || '').trim();
  if (!apiKey) {
    throw new Error('missing DashScope api key: set NIMI_DASHSCOPE_API_KEY or DASHSCOPE_API_KEY');
  }

  const rawModel = String(process.env.NIMI_DASHSCOPE_TTS_MODEL || DEFAULT_MODEL).trim();
  const model = normalizeModelForCloudRoute(rawModel);
  const baseUrl = String(process.env.NIMI_DASHSCOPE_BASE_URL || DEFAULT_BASE_URL).trim() || DEFAULT_BASE_URL;

  const runtimeDir = fileURLToPath(new URL('../../../runtime/', import.meta.url));
  if (!existsSync(runtimeDir)) {
    throw new Error(`runtime directory not found: ${runtimeDir}`);
  }
  const grpcPort = await allocatePort();
  const httpPort = await allocatePort();
  const endpoint = `127.0.0.1:${grpcPort}`;

  const daemon = spawn('go', ['run', './cmd/nimi', 'serve'], {
    cwd: runtimeDir,
    detached: true,
    env: {
      ...process.env,
      NIMI_RUNTIME_GRPC_ADDR: endpoint,
      NIMI_RUNTIME_HTTP_ADDR: `127.0.0.1:${httpPort}`,
      NIMI_RUNTIME_ENABLE_WORKERS: '0',
      NIMI_RUNTIME_LOCK_PATH: `/tmp/nimi-runtime-dashscope-tts-${Date.now()}-${Math.random().toString(36).slice(2)}.lock`,
      NIMI_RUNTIME_CLOUD_DASHSCOPE_BASE_URL: baseUrl,
      NIMI_RUNTIME_CLOUD_DASHSCOPE_API_KEY: apiKey,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let daemonStderr = '';
  daemon.stderr.on('data', (chunk) => {
    daemonStderr += String(chunk || '');
  });

  try {
    const { runtime } = await createPlatformClient({
      appId: APP_ID,
      runtimeTransport: {
        type: 'node-grpc',
        endpoint,
      },
      runtimeDefaults: {
        callerKind: 'desktop-core',
        callerId: 'dashscope-tts-debug',
      },
      realmBaseUrl: 'http://localhost:3002',
      subjectUserIdProvider: () => SUBJECT_USER_ID,
    });

    await waitForRuntimeReady(runtime);

    const withRoute = await runtime.media.tts.listVoices({
      model,
      route: 'cloud',
    });

    let withoutRouteError = '';
    try {
      await runtime.media.tts.listVoices({
        model,
      });
    } catch (error) {
      withoutRouteError = error instanceof Error ? error.message : String(error || '');
    }

    const voiceIds = withRoute.voices.map((voice) => String(voice.voiceId || '').trim()).filter(Boolean);
    const report = {
      ok: voiceIds.length > 0,
      endpoint,
      modelInput: rawModel,
      modelResolvedForCloud: model,
      listVoicesWithCloud: {
        traceId: withRoute.traceId,
        modelResolved: withRoute.modelResolved,
        voiceCount: withRoute.voices.length,
        voicesTop10: withRoute.voices.slice(0, 10).map((voice, index) => ({
          idx: index + 1,
          voiceId: voice.voiceId,
          name: voice.name,
          lang: voice.lang,
          supportedLangs: voice.supportedLangs,
        })),
      },
      comparisonWithoutRoute: {
        error: withoutRouteError || null,
      },
      nextDesktopChecks: [
        'Agent Chat VoicePanel: set TTS Route Source=cloud',
        'Agent Chat VoicePanel: choose DashScope connector',
        `Agent Chat VoicePanel: set TTS Model=${rawModel}`,
      ],
      daemonStdErrTail: daemonStderr.trim().split('\n').slice(-10),
    };

    console.log(JSON.stringify(report, null, 2));
    if (voiceIds.length === 0) {
      process.exitCode = 1;
    }
  } finally {
    await terminateDaemon(daemon);
  }
}

await main();
