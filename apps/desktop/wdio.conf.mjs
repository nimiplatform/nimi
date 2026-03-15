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

export const config = {
  runner: 'local',
  specs: ['apps/desktop/e2e/specs/**/*.e2e.mjs'],
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
      browserName: 'wry',
      'tauri:options': {
        application: process.env.NIMI_E2E_APPLICATION,
      },
    },
  ],
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

    try {
      const logs = await browser.getLogs('browser');
      const rendered = logs
        .map((entry) => `[${entry.level}] ${entry.message}`)
        .join('\n');
      fs.writeFileSync(consolePath, rendered, 'utf8');
    } catch {
      // Some drivers do not expose browser logs; keep artifact collection best-effort.
    }

    const rendererErrors = await collectRendererErrors();
    fs.writeFileSync(rendererErrorPath, `${JSON.stringify(rendererErrors, null, 2)}\n`, 'utf8');
    if (rendererErrors.length > 0) {
      throw new Error(`renderer console/page errors detected: ${rendererErrors.map((item) => `${item.kind}:${item.message}`).join(' | ')}`);
    }
  },
};

export default config;
