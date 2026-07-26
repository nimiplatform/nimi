import fs from 'node:fs';
import path from 'node:path';

const artifactDir = path.resolve(process.env.NIMI_E2E_ARTIFACT_DIR || 'apps/desktop/reports/e2e/latest');
fs.mkdirSync(artifactDir, { recursive: true });

async function installRendererErrorHooks() {
  await browser.execute(() => {
    const target = window;
    if (target.__NIMI_E2E_ERROR_HOOKS__) {
      return;
    }
    target.__NIMI_E2E_ERROR_HOOKS__ = true;
    target.__NIMI_E2E_RENDERER_ERRORS__ = [];

    const capture = (kind, value) => {
      const message = value instanceof Error ? value.message : String(value || '');
      target.__NIMI_E2E_RENDERER_ERRORS__.push({
        kind,
        message,
        at: new Date().toISOString(),
      });
    };

    const originalConsoleError = console.error.bind(console);
    console.error = (...args) => {
      capture('console.error', args.map((item) => {
        if (item instanceof Error) {
          return item.message;
        }
        return String(item);
      }).join(' '));
      originalConsoleError(...args);
    };

    window.addEventListener('error', (event) => {
      capture('window.error', event.error || event.message || 'unknown error');
    });
    window.addEventListener('unhandledrejection', (event) => {
      capture('unhandledrejection', event.reason || 'unhandled rejection');
    });
  });
}

async function collectRendererErrors() {
  try {
    return await browser.execute(() => window.__NIMI_E2E_RENDERER_ERRORS__ || []);
  } catch {
    return [];
  }
}

async function collectRendererDebugLogs() {
  try {
    return await browser.execute(() => window.__NIMI_RENDERER_DEBUG_LOGS__ || []);
  } catch {
    return [];
  }
}

async function preflightLiveProductControl() {
  if (process.env.NIMI_E2E_PRODUCT_CONTROL_PREFLIGHT !== 'ready') {
    return;
  }
  const result = await browser.execute(async () => {
    const hook = globalThis.window?.__NIMI_TAURI_RUNTIME__;
    if (!hook || typeof hook.invoke !== 'function') {
      return {
        ok: false,
        error: 'standard Desktop Tauri Runtime bridge is unavailable',
      };
    }
    try {
      const projection = await hook.invoke('product_control_record_get', {});
      return { ok: true, projection };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
  if (!result?.ok) {
    throw new Error(
      `live Runtime Product Control preflight failed: ${String(result?.error || 'unknown error')}`,
    );
  }
  const projection = result.projection;
  const dataRootStatus = String(projection?.record?.dataRoot?.status || '');
  if (
    projection?.exists !== true
    || projection?.state !== 'ready_for_use'
    || dataRootStatus !== 'ready'
  ) {
    throw new Error(
      'live Runtime Product Control preflight requires an existing ready_for_use '
      + `~/.nimi/nimi.json record; got ${JSON.stringify({
        exists: projection?.exists,
        state: projection?.state,
        dataRootStatus,
        error: projection?.error,
      })}`,
    );
  }
}

function loadArtifactPolicy() {
  const manifestPath = String(process.env.NIMI_E2E_ARTIFACT_MANIFEST || '').trim();
  if (!manifestPath) {
    return {};
  }
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    return manifest && typeof manifest.artifact_policy === 'object' ? manifest.artifact_policy : {};
  } catch {
    return {};
  }
}

function artifactMessageAllowlist(artifactPolicy, key) {
  const value = artifactPolicy && typeof artifactPolicy === 'object'
    ? artifactPolicy[key]
    : [];
  return Array.isArray(value)
    ? value.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
}

function isAllowedArtifactMessage(message, allowlist) {
  const text = String(message || '');
  return allowlist.some((allowed) => text.includes(allowed));
}

export const config = {
  runner: 'local',
  specs: ['e2e/specs/**/*.e2e.mjs'],
  maxInstances: 1,
  logLevel: 'info',
  baseUrl: 'tauri://localhost',
  waitforTimeout: 15000,
  connectionRetryTimeout: 120000,
  connectionRetryCount: 1,
  framework: 'mocha',
  mochaOpts: {
    ui: 'bdd',
    timeout: 120000,
  },
  reporters: ['spec'],
  hostname: process.env.NIMI_E2E_DRIVER_HOST || '127.0.0.1',
  port: Number(process.env.NIMI_E2E_DRIVER_PORT || '4444'),
  path: '/',
  capabilities: [
    {
      maxInstances: 1,
      'tauri:options': {
        application: process.env.NIMI_E2E_APPLICATION,
      },
    },
  ],
  before: async function () {
    await preflightLiveProductControl();
  },
  beforeTest: async function () {
    await installRendererErrorHooks();
  },
  afterTest: async function (test, context, result) {
    const safeName = String(test.fullTitle || test.title || 'test')
      .replace(/[^a-z0-9._-]+/gi, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase() || 'test';
    const prefix = `${process.env.NIMI_E2E_PROFILE || 'unknown'}-${safeName}`;
    const screenshotPath = path.join(artifactDir, `${prefix}.png`);
    const consolePath = path.join(artifactDir, `${prefix}.browser.log`);
    const sourcePath = path.join(artifactDir, `${prefix}.html`);
    const rendererErrorPath = path.join(artifactDir, `${prefix}.renderer-errors.json`);
    const rendererDebugPath = path.join(artifactDir, `${prefix}.renderer-debug.json`);

    if (!result.passed) {
      try {
        await browser.saveScreenshot(screenshotPath);
      } catch {
        // Best-effort failure diagnostics should not fail the test run.
      }
      try {
        const source = await browser.getPageSource();
        fs.writeFileSync(sourcePath, source, 'utf8');
      } catch {
        // Best-effort failure diagnostics should not fail the test run.
      }
    }

    let browserLogs = [];
    try {
      browserLogs = await browser.getLogs('browser');
      const rendered = browserLogs
        .map((entry) => `[${entry.level}] ${entry.message}`)
        .join('\n');
      fs.writeFileSync(consolePath, rendered, 'utf8');
    } catch {
      // Some drivers do not expose browser logs; keep artifact collection best-effort.
    }

    const artifactPolicy = loadArtifactPolicy();
    const allowedRendererMessages = artifactMessageAllowlist(artifactPolicy, 'allowedRendererErrorMessages');
    const rendererErrors = await collectRendererErrors();
    const rendererDebugLogs = await collectRendererDebugLogs();
    fs.writeFileSync(rendererDebugPath, `${JSON.stringify(rendererDebugLogs, null, 2)}\n`, 'utf8');
    const unexpectedRendererErrors = rendererErrors.filter((item) =>
      !isAllowedArtifactMessage(item.message, allowedRendererMessages),
    );
    fs.writeFileSync(rendererErrorPath, `${JSON.stringify(unexpectedRendererErrors, null, 2)}\n`, 'utf8');
    if (unexpectedRendererErrors.length > 0) {
      throw new Error(`renderer console/page errors detected: ${unexpectedRendererErrors.map((item) => `${item.kind}:${item.message}`).join(' | ')}`);
    }
    const allowedConsoleMessages = [
      ...allowedRendererMessages,
      ...artifactMessageAllowlist(artifactPolicy, 'allowedConsoleErrorMessages'),
    ];
    const severeBrowserLogs = browserLogs.filter((entry) =>
      String(entry.level || '').toUpperCase() === 'SEVERE'
      && !isAllowedArtifactMessage(entry.message, allowedConsoleMessages),
    );
    if (artifactPolicy.failOnConsoleError === true && severeBrowserLogs.length > 0) {
      throw new Error(`browser severe logs detected: ${severeBrowserLogs.map((entry) => String(entry.message || '')).join(' | ')}`);
    }
  },
};

export default config;
