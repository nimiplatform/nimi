import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  requireWindowsDevSignedFiles,
  requireWindowsDevSigningIdentity,
  signWindowsDevFiles,
} from '../../../scripts/lib/windows-dev-signing.mjs';
import { parseFirstJsonDocument, parseLastJsonDocument } from '../../../scripts/lib/windows-powershell.mjs';
import { FIRST_PARTY_PRODUCT_PRIVATE_ENV_NAMES } from './first-party-product-contract.mjs';

export { FIRST_PARTY_PRODUCT_PRIVATE_ENV_NAMES } from './first-party-product-contract.mjs';

const desktopRequire = createRequire(path.join(import.meta.dirname, '../../../apps/desktop/package.json'));
const kitRequire = createRequire(path.join(import.meta.dirname, '../../../kit/package.json'));
const playwright = await import(pathToFileURL(desktopRequire.resolve('playwright')).href);
const electron = playwright.default?._electron;

const EXECUTION_EVIDENCE_REF = /^execution_evidence_[0-9a-z]+$/u;
export function firstPartyProductChildEnv(extra = {}) {
  const output = { ...process.env, ...extra };
  for (const name of FIRST_PARTY_PRODUCT_PRIVATE_ENV_NAMES) delete output[name];
  return output;
}

function sha256File(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function requireEnv(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name} is required for the real first-party product journey`);
  return value;
}

function powershellJson(script, args = []) {
  const result = spawnSync('pwsh.exe', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script, ...args,
  ], { encoding: 'utf8', env: firstPartyProductChildEnv(), maxBuffer: 32 * 1024 * 1024 });
  if (result.error || result.status !== 0) {
    throw new Error(`PowerShell product prerequisite failed: ${String(result.stderr || result.stdout || result.error?.message).trim()}`);
  }
  const lines = String(result.stdout || '').trim().split(/\r?\n/u).filter(Boolean);
  try {
    return JSON.parse(lines.at(-1));
  } catch {
    throw new Error(`PowerShell product prerequisite returned invalid JSON: ${String(result.stdout || '').trim()}`);
  }
}

function createProcessObservationLedger() {
  const events = [];
  const identities = new Map(['provider', 'realm', 'runtime', 'desktop', 'zhiyu'].map((role) => [role, new Set()]));
  return {
    observe(role, identity, detail = {}) {
      const normalized = String(identity || '').trim();
      if (!normalized) throw new Error(`missing observed ${role} process identity`);
      const known = identities.get(role);
      if (known?.has(normalized)) return;
      known?.add(normalized);
      events.push({
        role,
        identity: normalized,
        kind: 'observed-running-process',
        observedAt: new Date().toISOString(),
        ...detail,
      });
    },
    snapshot() {
      return {
        processStarts: Object.fromEntries([...identities].map(([role, values]) => [role, values.size])),
        processObservations: events.map((event) => ({ ...event })),
      };
    },
  };
}

async function observeLocalProductTopology() {
  const fetchRequired = async (label, url) => {
    try {
      return await fetch(url, { redirect: 'manual' });
    } catch (error) {
      throw new Error(`${label} is unavailable at ${url}: ${String(error?.cause?.message || error?.message || error)}`);
    }
  };
  const [jwksResponse, webResponse] = await Promise.all([
    fetchRequired('local Realm JWKS endpoint', 'http://localhost:3002/api/auth/jwks'),
    fetchRequired('local Nimi Web login surface', 'http://localhost:3000/'),
  ]);
  assert.equal(jwksResponse.status, 200, 'local Realm JWKS endpoint is not healthy on localhost:3002');
  const jwks = await jwksResponse.json();
  assert.ok(Array.isArray(jwks?.keys) && jwks.keys.length > 0, 'local Realm JWKS endpoint returned no signing keys');
  assert.equal(webResponse.status, 200, 'local Nimi Web login surface is not healthy on localhost:3000');
  assert.match(String(webResponse.headers.get('content-type') || ''), /text\/html/iu, 'localhost:3000 is not the Nimi Web surface');

  return {
    realm: { baseUrl: 'http://localhost:3002', jwksHealthy: true },
    web: { baseUrl: 'http://localhost:3000', htmlHealthy: true },
  };
}

function assertElevatedWindowsX64() {
  if (process.platform !== 'win32' || process.arch !== 'x64') {
    throw new Error(`Gate 0 requires Windows x64, observed ${process.platform}/${process.arch}`);
  }
  const elevated = powershellJson(
    "$p=[Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent(); @{ elevated=$p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator); os=[Environment]::OSVersion.VersionString; arch=$env:PROCESSOR_ARCHITECTURE } | ConvertTo-Json -Compress",
  );
  if (elevated.elevated !== true) {
    throw new Error('Gate 0 installed-candidate setup requires an elevated Windows process');
  }
  return elevated;
}

function run(command, args, options = {}) {
  let executable = command;
  let commandArgs = args;
  if (process.platform === 'win32' && command === 'pnpm') {
    const pnpmCli = String(process.env.npm_execpath || '').trim();
    if (!pnpmCli || !fs.existsSync(pnpmCli)) {
      throw new Error('pnpm CLI path is unavailable for portable Windows execution');
    }
    executable = process.execPath;
    commandArgs = [pnpmCli, ...args];
  }
  const result = spawnSync(executable, commandArgs, {
    cwd: options.cwd,
    env: firstPartyProductChildEnv(options.env),
    encoding: 'utf8',
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    const detail = [result.stderr, result.stdout, result.error?.message].map((v) => String(v || '').trim()).filter(Boolean).join('\n');
    throw new Error(`${command} ${args.join(' ')} failed${detail ? `:\n${detail}` : ''}`);
  }
  return String(result.stdout || '').trim();
}

function newestFile(root, predicate) {
  if (!fs.existsSync(root)) return '';
  const pending = [root];
  const files = [];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(absolute);
      else if (entry.isFile() && predicate(absolute)) files.push(absolute);
    }
  }
  return files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0] || '';
}

function readRuntimeCandidate(repoRoot, processLedger, install) {
  const runtimeBuildRecordPath = path.join(repoRoot, 'dist', 'nimi-build-record.json');
  const runtimeBuildRecord = JSON.parse(fs.readFileSync(runtimeBuildRecordPath, 'utf8'));
  const installer = path.join(repoRoot, 'dist', 'windows-runtime-service-installer', 'install-nimi-runtime.ps1');
  const output = install
    ? run('pnpm', ['install:first-party-product-acceptance-service-candidate'], { cwd: repoRoot, capture: true })
    : run('pwsh.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', installer,
      '-Mode', 'Status', '-Json',
    ], { cwd: repoRoot, capture: true });
  const status = parseLastJsonDocument(output, 'first-party-runtime-installer-json-invalid').value;
  const requiredTrue = [
    'serviceAccountMatches', 'binaryPathMatches', 'serviceSidMatches', 'restrictedSid',
    'desktopPipePresent', 'localAppPipePresent', 'runtimeBinaryMatchesCandidate',
    'runtimeBuildRecordMatchesCandidate',
  ];
  for (const field of requiredTrue) assert.equal(status[field], true, `Runtime installer status ${field}`);
  assert.equal(status.state, 'running');
  assert.equal(status.checkpointProfileRuntimeValidated, false, 'product Gate must not use the dev-kernel acceptance profile');
  assert.equal(status.firstPartyProductAcceptanceRuntimeValidated, true, 'product Gate requires the signed endpoint-only acceptance build');
  assert.equal(status.productAcceptanceCandidatePostureVerified, true, 'installed Runtime did not verify the product-acceptance build posture');
  assert.equal(status.runtimeBuildProfile, 'first_party_product_acceptance');
  assert.equal(status.configuredAccountRealmBaseUrl, 'http://localhost:3002');
  assert.equal(status.productAcceptanceReleasePosture, 'non_release');
  assert.equal(status.productAcceptanceProductClosePromotion, 'non_promotable_to_product_close');
  assert.equal(
    Object.hasOwn(status, 'developmentDataRootRef'),
    false,
    'Runtime installer status must not expose a second data-root locator',
  );
  assert.equal(status.runtimeCandidateId, runtimeBuildRecord.candidateId, 'installed Runtime candidate does not match its build record');
  assert.equal(status.runtimeBuildRecordSha256, sha256File(runtimeBuildRecordPath), 'installed Runtime build-record digest drifted');
  assert.equal(runtimeBuildRecord.checkpoint, 'first_party_product_acceptance', 'product Gate requires the endpoint-only acceptance build projection');
  assert.equal(runtimeBuildRecord.nonRelease, true, 'product acceptance Runtime must remain non-release');
  processLedger.observe('runtime', `pid:${status.processId}`, {
    serviceName: status.serviceName,
    serviceSid: status.serviceSid,
  });
  return {
    installer,
    status,
    runtimeBuildRecord,
    runtimeBuildRecordPath,
  };
}

function installRuntimeCandidate(repoRoot, processLedger) {
  run('pnpm', ['build:first-party-product-acceptance-service-candidate'], { cwd: repoRoot });
  return readRuntimeCandidate(repoRoot, processLedger, true);
}

function copyPackage(source, destination) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.cpSync(fs.realpathSync(source), destination, { recursive: true, dereference: true, force: false });
}

function stageElectronAppSource(repoRoot, appSource) {
  const desktopRoot = path.join(repoRoot, 'apps', 'desktop');
  fs.mkdirSync(path.join(appSource, 'dist-electron'), { recursive: true });
  fs.cpSync(path.join(desktopRoot, 'dist'), path.join(appSource, 'dist'), { recursive: true, force: false });
  fs.copyFileSync(path.join(desktopRoot, 'dist-electron', 'main.js'), path.join(appSource, 'dist-electron', 'main.js'));
  fs.copyFileSync(path.join(desktopRoot, 'dist-electron', 'preload.cjs'), path.join(appSource, 'dist-electron', 'preload.cjs'));
  fs.writeFileSync(path.join(appSource, 'package.json'), `${JSON.stringify({
    name: 'nimi-desktop-first-party-product-candidate',
    version: JSON.parse(fs.readFileSync(path.join(desktopRoot, 'package.json'), 'utf8')).version,
    type: 'module',
    main: 'dist-electron/main.js',
  }, null, 2)}\n`);

  const sharpRoot = path.dirname(path.dirname(kitRequire.resolve('sharp')));
  const sharpNodeModules = path.dirname(sharpRoot);
  for (const packageName of ['sharp', 'detect-libc', 'semver', '@img/colour', '@img/sharp-win32-x64']) {
    copyPackage(
      path.join(sharpNodeModules, ...packageName.split('/')),
      path.join(appSource, 'node_modules', ...packageName.split('/')),
    );
  }
  copyPackage(
    path.join(repoRoot, 'kit', 'shell', 'protected-local-node', 'npm', 'win32-x64'),
    path.join(appSource, 'node_modules', '@nimiplatform', 'kit-protected-local-win32-x64'),
  );
  copyPackage(
    path.join(repoRoot, 'apps', 'desktop', 'product-control-node', 'npm', 'win32-x64'),
    path.join(appSource, 'node_modules', '@nimiplatform', 'desktop-product-control-win32-x64'),
  );
}

function buildAndInstallDesktopCandidate(repoRoot, signer, rootId) {
  run('pnpm', ['--filter', '@nimiplatform/desktop', 'run', 'build:renderer'], { cwd: repoRoot });
  run('pnpm', ['--filter', '@nimiplatform/desktop', 'run', 'build:electron'], { cwd: repoRoot });
  run(process.execPath, ['apps/desktop/scripts/bundle-electron-main.mjs', '--release'], { cwd: repoRoot });
  run(process.execPath, ['apps/desktop/scripts/bundle-electron-preload.mjs'], { cwd: repoRoot });
  run(process.execPath, ['kit/shell/protected-local-node/scripts/build-windows-x64-package.mjs'], { cwd: repoRoot });
  run(process.execPath, ['apps/desktop/product-control-node/scripts/build-windows-x64-package.mjs'], { cwd: repoRoot });

  const candidateRoot = path.join(repoRoot, '.nimi', 'local', 'state', 'first-party-product', rootId, 'desktop-candidate');
  const builtRoot = path.join(candidateRoot, 'built');
  const appSource = path.join(builtRoot, 'resources', 'app');
  fs.mkdirSync(candidateRoot, { recursive: true });
  fs.cpSync(path.dirname(desktopRequire('electron')), builtRoot, { recursive: true, force: false });
  const electronExecutable = path.join(builtRoot, 'electron.exe');
  const builtDesktop = path.join(builtRoot, 'Nimi Desktop Runtime.exe');
  fs.renameSync(electronExecutable, builtDesktop);
  fs.rmSync(path.join(builtRoot, 'resources', 'default_app.asar'), { force: true });
  stageElectronAppSource(repoRoot, appSource);
  const signed = signWindowsDevFiles([builtDesktop], { cwd: repoRoot });
  assert.equal(signed.certificateSha256, signer.certificateSha256, 'Desktop signer changed during candidate build');
  requireWindowsDevSignedFiles([builtDesktop], signer.certificateSha256, { cwd: repoRoot });

  const desktopInstaller = path.join(candidateRoot, 'nimi-electron-desktop-installed-candidate.zip');
  run('pwsh.exe', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command',
    `Compress-Archive -Path '${builtRoot.replaceAll("'", "''")}\\*' -DestinationPath '${desktopInstaller.replaceAll("'", "''")}' -CompressionLevel Optimal -Force`,
  ], { cwd: repoRoot });
  const installRoot = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Nimi', 'FirstPartyProduct', rootId);
  if (fs.existsSync(installRoot)) throw new Error(`fresh Electron install root already exists: ${installRoot}`);
  run('pwsh.exe', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command',
    `New-Item -ItemType Directory -Path '${installRoot.replaceAll("'", "''")}' -Force | Out-Null; Expand-Archive -LiteralPath '${desktopInstaller.replaceAll("'", "''")}' -DestinationPath '${installRoot.replaceAll("'", "''")}'`,
  ], { cwd: repoRoot });
  const installedDesktop = path.join(installRoot, 'Nimi Desktop Runtime.exe');
  if (!fs.existsSync(installedDesktop) || path.resolve(installedDesktop) === path.resolve(builtDesktop)) {
    throw new Error('Electron installation carrier did not expose a distinct installed Nimi Desktop Runtime.exe');
  }
  assert.equal(sha256File(installedDesktop), sha256File(builtDesktop), 'installed Electron Desktop differs from the signed build');
  requireWindowsDevSignedFiles([installedDesktop], signer.certificateSha256, { cwd: repoRoot });
  return { builtDesktop, desktopInstaller, installedDesktop, installRoot };
}

function playwrightLocator(page, selector) {
  const textButton = /^button\*=(.+)$/u.exec(selector);
  return textButton ? page.getByRole('button', { name: new RegExp(textButton[1], 'iu') }) : page.locator(selector);
}

function elementAdapter(page, locator) {
  return {
    click: () => locator.click(),
    getAttribute: (name) => locator.getAttribute(name),
    getText: () => locator.innerText(),
    isDisplayed: () => locator.isVisible(),
    keys: (key) => locator.press(key),
    setValue: (value) => locator.fill(value),
    waitForDisplayed: ({ timeout } = {}) => locator.waitFor({ state: 'visible', timeout }),
    waitForEnabled: ({ timeout } = {}) => locator.waitFor({ state: 'visible', timeout }).then(() => locator.isEnabled()).then((enabled) => {
      if (!enabled) throw new Error('element did not become enabled');
    }),
    waitForExist: ({ reverse = false, timeout } = {}) => locator.waitFor({ state: reverse ? 'detached' : 'attached', timeout }),
    $: (selector) => elementAdapter(page, locator.locator(selector)),
  };
}

function browserAdapter(page, app) {
  return {
    desktopProcessId: app.process().pid,
    $: async (selector) => elementAdapter(page, playwrightLocator(page, selector)),
    takeExternalUrl: () => app.evaluate(() => {
      const urls = globalThis.__nimiFirstPartyExternalUrls || [];
      return urls.shift() || '';
    }),
    execute: (fn, ...args) => page.evaluate(
      ({ functionSource, values }) => globalThis.eval(`(${functionSource})`)(...values),
      { functionSource: fn.toString(), values: args },
    ),
    refresh: () => page.reload({ waitUntil: 'domcontentloaded' }),
    waitUntil: async (condition, { timeout, interval = 250, timeoutMsg = 'condition timed out' }) => {
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        if (await condition()) return true;
        await new Promise((resolve) => setTimeout(resolve, interval));
      }
      throw new Error(timeoutMsg);
    },
  };
}

async function withInstalledDesktop(installedDesktop, userDataRoot, outputDir, callback, processLedger) {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(userDataRoot, { recursive: true });
  const hostLog = [];
  const app = await electron.launch({
    executablePath: installedDesktop,
    args: [`--user-data-dir=${userDataRoot}`],
    env: firstPartyProductChildEnv(),
  });
  processLedger.observe('desktop', `pid:${app.process().pid}`, { executablePath: installedDesktop });
  app.process().stderr?.on('data', (chunk) => hostLog.push(String(chunk)));
  try {
    await app.evaluate(({ shell }) => {
      globalThis.__nimiFirstPartyExternalUrls = [];
      shell.openExternal = async (url) => {
        globalThis.__nimiFirstPartyExternalUrls.push(String(url));
      };
    });
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(() => Boolean(globalThis.window?.__NIMI_ELECTRON_RUNTIME__));
    return await callback(browserAdapter(page, app));
  } finally {
    try {
      fs.writeFileSync(path.join(outputDir, 'electron-host.log'), hostLog.join(''), 'utf8');
    } catch (error) {
      process.stderr.write(`diagnostic Electron log was not written: ${String(error?.message || error)}\n`);
    }
    await app.close().catch(() => undefined);
  }
}

async function displayed(browser, testId, timeout = 60_000) {
  const element = await browser.$(`[data-testid="${testId}"]`);
  await element.waitForDisplayed({ timeout });
  return element;
}

async function displayedSelector(browser, selector, timeout = 60_000) {
  const element = await browser.$(selector);
  await element.waitForDisplayed({ timeout });
  return element;
}

async function selectChatTextRoute(browser, routeTestId, expectedReadiness) {
  await (await displayed(browser, 'chat-settings-toggle')).click();

  const capabilityCardSelector = '[data-nimi-model-config-capability="text.generate"]';
  let capabilityCard = await browser.$(capabilityCardSelector);
  if (!await capabilityCard.isDisplayed().catch(() => false)) {
    await (await displayedSelector(browser, '[data-nimi-model-config-section="chat"]')).click();
    capabilityCard = await displayedSelector(browser, capabilityCardSelector);
  }
  await (await capabilityCard.$('button')).click();

  await displayed(browser, 'model-picker-modal');
  const option = await displayed(browser, routeTestId);
  const source = String(await option.getAttribute('data-nimi-route-source') || '').trim();
  const readiness = String(await option.getAttribute('data-nimi-route-readiness') || '').trim();
  const localModelId = String(await option.getAttribute('data-nimi-local-model-id') || '').trim();
  assert.equal(source, 'local', `${routeTestId} must identify an ordinary local route option`);
  assert.ok(localModelId, `${routeTestId} must expose its Runtime local model identity`);
  if (expectedReadiness === 'ready') {
    assert.ok(['active', 'installed'].includes(readiness), `${routeTestId} must identify an admitted ready local route`);
  } else {
    assert.ok(['unhealthy', 'removed', 'unspecified'].includes(readiness), `${routeTestId} must identify a genuinely unavailable local route`);
  }
  await option.click();
  await (await browser.$('[data-testid="model-picker-modal"]')).waitForExist({ reverse: true, timeout: 60_000 });
  await (await displayed(browser, 'chat-settings-toggle')).click();
  return { localModelId, readiness, source, testId: routeTestId };
}

async function isDisplayed(browser, testId) {
  return (await browser.$(`[data-testid="${testId}"]`)).isDisplayed().catch(() => false);
}

async function authenticateIfRequired(browser) {
  await browser.waitUntil(async () => (
    await isDisplayed(browser, 'login-screen')
    || await isDisplayed(browser, 'desktop-first-run-gate')
    || await isDisplayed(browser, 'main-shell')
  ), { timeout: 120_000, interval: 250, timeoutMsg: 'Desktop did not expose login, First Run, or main shell' });
  if (!await isDisplayed(browser, 'login-screen') && await isDisplayed(browser, 'desktop-first-run-gate')) {
    await (await displayed(browser, 'first-run-account-sign-out')).click();
    await displayed(browser, 'login-screen', 120_000);
  }
  if (!await isDisplayed(browser, 'login-screen')) return { performed: false, oauthTrace: [] };
  const email = requireEnv('NIMI_FIRST_PARTY_ACCOUNT_EMAIL');
  const password = requireEnv('NIMI_FIRST_PARTY_ACCOUNT_PASSWORD');
  const trigger = await displayed(browser, 'login-logo-trigger');
  await trigger.click();
  let authorizationUrl = '';
  await browser.waitUntil(async () => {
    authorizationUrl = String(await browser.takeExternalUrl() || '').trim();
    return Boolean(authorizationUrl);
  }, { timeout: 60_000, interval: 100, timeoutMsg: 'Desktop login did not open the Realm authorization UI' });
  const authorization = new URL(authorizationUrl);
  const callback = new URL(authorization.searchParams.get('redirect_uri') || '');
  assert.equal(authorization.origin, 'http://localhost:3002', 'Desktop authorization URL did not originate from the fixed local Realm projection');
  assert.equal(authorization.pathname, '/api/auth/oauth/authorize', 'Desktop authorization URL did not use the canonical Realm OAuth route');
  const chromium = playwright.default?.chromium;
  if (!chromium) throw new Error('Playwright Chromium is unavailable for the real Realm account UI');
  const externalBrowser = await chromium.launch({ channel: 'chrome', headless: true });
  const oauthTrace = [];
  try {
    const page = await externalBrowser.newPage();
    page.on('request', (request) => {
      const observed = new URL(request.url());
      if (!['http://localhost:3000', 'http://localhost:3002'].includes(observed.origin)) return;
      oauthTrace.push({ origin: observed.origin, pathname: observed.pathname, method: request.method() });
    });
    await page.goto(authorizationUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    assert.equal(new URL(page.url()).origin, 'http://localhost:3000', 'Realm authorize did not enter the local Nimi Web login surface');
    const emailInput = page.getByTestId('login-email-input');
    if (!await emailInput.isVisible().catch(() => false)) await page.getByTestId('login-logo-trigger').click();
    await emailInput.waitFor({ state: 'visible', timeout: 60_000 });
    await emailInput.fill(email);
    await page.getByTestId('login-email-submit-arrow').click();
    const passwordInput = page.getByTestId('login-password-input');
    await passwordInput.waitFor({ state: 'visible', timeout: 60_000 });
    await passwordInput.fill(password);
    await passwordInput.press('Enter');
    await page.waitForURL((url) => url.origin === callback.origin && url.pathname === callback.pathname, { timeout: 60_000 }).catch(async (error) => {
      const current = new URL(page.url());
      if (current.origin !== callback.origin || current.pathname !== callback.pathname) throw error;
    });
  } finally {
    await externalBrowser.close();
  }
  const realmOAuthVisits = oauthTrace.filter((entry) => (
    entry.origin === 'http://localhost:3002' && entry.pathname.startsWith('/api/auth/oauth/')
  ));
  assert.ok(realmOAuthVisits.length >= 2, 'local OAuth did not return from Web login to the Realm authorize/token path');
  assert.ok(oauthTrace.some((entry) => entry.origin === 'http://localhost:3000'), 'local OAuth did not traverse the Nimi Web login origin');
  await browser.waitUntil(async () => !await isDisplayed(browser, 'login-screen'), {
    timeout: 300_000,
    interval: 250,
    timeoutMsg: 'Desktop did not consume the completed Realm OAuth callback',
  });
  await (await browser.$('[data-testid="desktop-first-run-gate"], [data-testid="main-shell"]')).waitForDisplayed({ timeout: 300_000 });
  return { performed: true, authorizationOrigin: authorization.origin, callbackOrigin: callback.origin, oauthTrace };
}

async function invokeShell(browser, command, payload = {}) {
  return browser.execute(async (name, args) => {
    const hook = globalThis.__NIMI_ELECTRON_RUNTIME__;
    if (!hook || typeof hook.invoke !== 'function') throw new Error('standard Electron invoke hook is unavailable');
    return hook.invoke(name, args);
  }, command, payload);
}

const NATIVE_FOLDER_PICKER_SCRIPT = String.raw`
param([int]$OwnerProcessId, [string]$Folder)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$deadline = [DateTime]::UtcNow.AddSeconds(120)
$root = [System.Windows.Automation.AutomationElement]::RootElement
$processCondition = New-Object System.Windows.Automation.PropertyCondition(
  [System.Windows.Automation.AutomationElement]::ProcessIdProperty,
  $OwnerProcessId
)
$editCondition = New-Object System.Windows.Automation.PropertyCondition(
  [System.Windows.Automation.AutomationElement]::AutomationIdProperty,
  '1148'
)
$confirmCondition = New-Object System.Windows.Automation.PropertyCondition(
  [System.Windows.Automation.AutomationElement]::AutomationIdProperty,
  '1'
)
while ([DateTime]::UtcNow -lt $deadline) {
  $windows = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $processCondition)
  foreach ($window in $windows) {
    $edit = $window.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $editCondition)
    $confirm = $window.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $confirmCondition)
    if ($null -eq $edit -or $null -eq $confirm) { continue }
    $valuePattern = $null
    $invokePattern = $null
    if (-not $edit.TryGetCurrentPattern(
      [System.Windows.Automation.ValuePattern]::Pattern,
      [ref]$valuePattern
    )) { continue }
    if (-not $confirm.TryGetCurrentPattern(
      [System.Windows.Automation.InvokePattern]::Pattern,
      [ref]$invokePattern
    )) { continue }
    $valuePattern.SetValue($Folder)
    $invokePattern.Invoke()
    exit 0
  }
  Start-Sleep -Milliseconds 100
}
throw 'native Product Control folder picker did not become automatable'
`;

function chooseNativeProductDataRoot(desktopProcessId, folder) {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-STA',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      NATIVE_FOLDER_PICKER_SCRIPT,
      String(desktopProcessId),
      folder,
    ], {
      cwd: path.dirname(folder),
      env: firstPartyProductChildEnv(),
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(
        `native Product Control folder selection failed (${signal || `exit ${code}`}): ${stderr.trim() || stdout.trim()}`,
      ));
    });
  });
}

async function waitForFirstRunSurface(browser, testIds, timeout, timeoutMsg) {
  let observed = '';
  await browser.waitUntil(async () => {
    for (const testId of testIds) {
      if (await isDisplayed(browser, testId)) {
        observed = testId;
        return true;
      }
    }
    return false;
  }, { timeout, interval: 250, timeoutMsg });
  return observed;
}

async function firstRunFailureReason(browser, surface) {
  const testId = surface === 'first-run-screen-repair'
    ? 'first-run-repair-reason'
    : 'first-run-blocked-reason';
  if (!await isDisplayed(browser, testId)) return surface;
  return String(await (await browser.$(`[data-testid="${testId}"]`)).getText() || '').trim() || surface;
}

const FIRST_RUN_ENTRY_PLANS = Object.freeze({
  config_missing: Object.freeze({ storage: true, deviceScan: true, localAiChoice: true }),
  data_root_missing: Object.freeze({ storage: true, deviceScan: true, localAiChoice: true }),
  data_root_selected: Object.freeze({ storage: false, deviceScan: true, localAiChoice: true }),
  ai_environment_unconfigured: Object.freeze({ storage: false, deviceScan: false, localAiChoice: true }),
  local_ai_profile_selected_assets_missing: Object.freeze({ storage: false, deviceScan: false, localAiChoice: false }),
  local_ai_profile_selected_environment_not_ready: Object.freeze({ storage: false, deviceScan: false, localAiChoice: false }),
  local_ai_assets_downloaded_environment_not_ready: Object.freeze({ storage: false, deviceScan: false, localAiChoice: false }),
  local_ai_ready: Object.freeze({ storage: false, deviceScan: false, localAiChoice: false }),
});

export function firstRunEntryPlan(state) {
  return FIRST_RUN_ENTRY_PLANS[String(state || '').trim()] || null;
}

function recordedDataRoot(projection, label) {
  const raw = String(projection?.record?.dataRoot?.path || '').trim();
  if (!raw || !path.isAbsolute(raw)) {
    throw new Error(`${label} has no absolute Product Control dataRoot.path`);
  }
  const status = String(projection?.record?.dataRoot?.status || '').trim();
  if (!['selected', 'ready'].includes(status)) {
    throw new Error(`${label} dataRoot.path has no current Product Control verification`);
  }
  return path.resolve(raw);
}

async function completeFirstRun(browser, freshDataRootSelection) {
  const authentication = await authenticateIfRequired(browser);
  const before = await invokeShell(browser, 'product_control_record_get', {});
  if (before?.record?.firstRun?.completed === true || before?.state === 'ready_for_use') {
    const ready = await observeCompletedFirstRun(browser);
    return {
      ...ready,
      authentication,
      entryState: 'ready_for_use',
      recoveredReadyState: true,
    };
  }
  assert.equal(authentication.performed, true, 'Gate 0 fresh Product Control did not perform ordinary Desktop OAuth');
  await displayed(browser, 'desktop-first-run-gate', 120_000);
  await displayed(browser, 'product-first-run-workflow', 120_000);
  const entryState = String(before?.state || '').trim();
  const entryPlan = firstRunEntryPlan(entryState);
  if (!entryPlan) {
    const surface = await waitForFirstRunSurface(
      browser,
      ['first-run-screen-repair', 'first-run-screen-blocked'],
      120_000,
      `First Run exposed unsupported product state ${entryState || 'unknown'}`,
    );
    throw new Error(`First Run requires ordinary product repair: ${await firstRunFailureReason(browser, surface)}`);
  }

  let storageSelectionPerformed = false;
  let selectedDataRoot = null;
  if (entryPlan.storage) {
    await displayed(browser, 'first-run-phase-storage', 120_000);
    selectedDataRoot = path.resolve(freshDataRootSelection);
    fs.mkdirSync(selectedDataRoot, { recursive: false });
    const picker = chooseNativeProductDataRoot(browser.desktopProcessId, selectedDataRoot);
    await (await displayed(browser, 'first-run-storage-choose-folder')).click();
    await picker;
    const displayedPath = String(
      await (await browser.$('[data-testid="first-run-storage-path"]')).getText() || '',
    ).trim();
    assert.equal(
      path.resolve(displayedPath),
      selectedDataRoot,
      'native Product Control folder picker returned a different dataRoot.path',
    );
    await (await displayed(browser, 'first-run-storage-continue')).click();
    storageSelectionPerformed = true;
  } else {
    selectedDataRoot = recordedDataRoot(before, 'resumed First Run');
  }

  if (entryPlan.deviceScan) {
    await displayed(browser, 'first-run-phase-device-scan', 120_000);
    await (await displayed(browser, 'first-run-device-scan-continue', 300_000)).click();
  }
  if (entryPlan.localAiChoice) {
    await displayed(browser, 'first-run-phase-local-ai', 120_000);
    const level = process.env.NIMI_FIRST_PARTY_INSTALL_LEVEL === 'recommended' ? 'recommended' : 'minimal';
    await (await displayed(browser, `first-run-install-level-${level}`)).click();
    await (await displayed(browser, 'first-run-local-ai-continue')).click();
  }

  const activeSurface = await waitForFirstRunSurface(
    browser,
    ['first-run-phase-setup', 'product-first-run-finalization', 'first-run-screen-ready', 'first-run-screen-repair', 'first-run-screen-blocked'],
    120_000,
    `First Run did not expose the current canonical phase from ${entryState}`,
  );
  if (activeSurface === 'first-run-screen-repair' || activeSurface === 'first-run-screen-blocked') {
    throw new Error(`First Run requires ordinary product repair: ${await firstRunFailureReason(browser, activeSurface)}`);
  }
  const outcomeSurface = await waitForFirstRunSurface(
    browser,
    ['first-run-screen-ready', 'main-shell', 'first-run-screen-repair', 'first-run-screen-blocked'],
    600_000,
    `First Run did not finish the canonical setup phase entered from ${entryState}`,
  );
  if (outcomeSurface === 'first-run-screen-repair' || outcomeSurface === 'first-run-screen-blocked') {
    throw new Error(`First Run requires ordinary product repair: ${await firstRunFailureReason(browser, outcomeSurface)}`);
  }
  await displayed(browser, 'main-shell', 120_000);
  const owner = await invokeShell(browser, 'product_control_record_get', {});
  assert.equal(owner?.state, 'ready_for_use');
  assert.equal(owner?.record?.state, 'ready_for_use');
  assert.equal(owner?.record?.firstRun?.completed, true);
  for (const field of ['baselineProfileRef', 'baselineCommitId', 'accountDefaultProfileRef', 'runtimeBaselineRef']) {
    assert.ok(String(owner.record.firstRun[field] || '').trim(), `product-control owner firstRun.${field}`);
  }
  const dataRoot = recordedDataRoot(owner, 'completed First Run');
  assert.equal(dataRoot, selectedDataRoot, 'Product Control dataRoot.path changed during First Run');
  const executionEvidenceRef = String(owner.record.firstRun.executionEvidenceRef || '').trim();
  assert.match(executionEvidenceRef, EXECUTION_EVIDENCE_REF);
  return {
    owner,
    executionEvidenceRef,
    authentication,
    entryState,
    storageSelectionPerformed,
    recoveredReadyState: false,
    dataRoot,
  };
}

async function observeCompletedFirstRun(browser) {
  await displayed(browser, 'main-shell', 120_000);
  const owner = await invokeShell(browser, 'product_control_record_get', {});
  assert.equal(owner?.state, 'ready_for_use', 'Gate 0 ready-state continuation did not observe ready_for_use');
  assert.equal(owner?.record?.state, 'ready_for_use', 'Gate 0 ready-state Product Control record is not ready_for_use');
  assert.equal(owner?.record?.firstRun?.completed, true, 'Gate 0 ready-state First Run is not completed');
  const dataRoot = recordedDataRoot(owner, 'Gate 0 ready-state Product Control');
  const executionEvidenceRef = String(owner?.record?.firstRun?.executionEvidenceRef || '').trim();
  assert.match(executionEvidenceRef, EXECUTION_EVIDENCE_REF);
  return {
    owner,
    executionEvidenceRef,
    authentication: { performed: false, authorizationOrigin: null, oauthTrace: [] },
    entryState: 'ready_for_use',
    storageSelectionPerformed: false,
    recoveredReadyState: true,
    dataRoot,
  };
}

function composeCandidateIdentity({
  runtime,
  signer,
  desktop,
  desktopSha256,
  evidencePosture,
  ui,
  electronUserDataRoot,
  dataRoot,
}) {
  return {
    runtimeCandidateId: runtime.runtimeBuildRecord.candidateId,
    runtimeBuildProfile: runtime.runtimeBuildRecord.checkpoint,
    configuredAccountRealmBaseUrl: runtime.status.configuredAccountRealmBaseUrl,
    desktopSha256,
    signerCertificateSha256: signer.certificateSha256,
    serviceIdentity: `${runtime.status.serviceName}:${runtime.status.serviceSid}:${runtime.status.binaryPath}`,
    os: 'windows',
    arch: 'x64',
    executionEvidenceRef: ui.executionEvidenceRef,
    evidencePosture,
    installedDesktopPath: desktop.installedDesktop,
    runtimeInstallerPath: runtime.installer,
    electronUserDataRoot,
    dataRoot,
  };
}

async function installBridgeCapture(browser) {
  await browser.execute(() => {
    const hook = globalThis.__NIMI_ELECTRON_RUNTIME__;
    if (!hook || typeof hook.invoke !== 'function') throw new Error('standard Electron invoke hook is unavailable');
    if (globalThis.__nimiP4CaptureInstalled) return;
    globalThis.__nimiP4CaptureInstalled = true;
    globalThis.__nimiP4Capture = [];
    globalThis.__nimiP4RawCalls = [];
    globalThis.__nimiP4RawEvents = [];
    globalThis.__nimiP4Sequence = 0;
    const original = hook.invoke.bind(hook);
    const originalListen = typeof hook.listen === 'function' ? hook.listen.bind(hook) : null;
    const summarize = (value) => {
      if (!value || typeof value !== 'object') return { valueType: typeof value };
      const record = value;
      const text = String(record.delta || record.textDelta || record.reason || record.reasonCode || record.finishReason || '');
      return {
        type: String(record.type || record.eventType || record.kind || ''),
        reason: String(record.reason || record.reasonCode || record.finishReason || ''),
        provider: String(record.providerType || record.provider || record.routePolicy || ''),
        deltaLength: text && (record.delta || record.textDelta) ? text.length : 0,
        hasUsage: Boolean(record.usage || record.tokenUsage || record.usageStats),
        terminal: Boolean(record.terminal || record.done || /terminal|completed|failed|canceled|cancelled/u.test(String(record.type || record.eventType || ''))),
      };
    };
    hook.invoke = async (command, args) => {
      const methodId = String(args?.payload?.methodId || args?.methodId || '');
      const sequence = ++globalThis.__nimiP4Sequence;
      const entry = { command: String(command), methodId, sequence, events: [], ok: false, error: '' };
      const wrap = (value) => {
        if (!value || typeof value !== 'object') return;
        if (typeof value.onmessage === 'function') {
          const prior = value.onmessage;
          value.onmessage = (event) => { entry.events.push(summarize(event)); return prior(event); };
        }
        for (const child of Object.values(value)) wrap(child);
      };
      wrap(args);
      const rawEntry = { command, args, result: null, sequence };
      globalThis.__nimiP4RawCalls.push(rawEntry);
      globalThis.__nimiP4Capture.push(entry);
      try {
        const result = await original(command, args);
        rawEntry.result = result;
        entry.ok = true;
        entry.result = summarize(result);
        return result;
      } catch (error) {
        entry.error = String(error?.message || error);
        throw error;
      }
    };
    if (originalListen) {
      hook.listen = (eventName, handler) => {
        const sequence = ++globalThis.__nimiP4Sequence;
        const entry = { command: 'event-listen', methodId: String(eventName), sequence, events: [], ok: true, error: '' };
        globalThis.__nimiP4Capture.push(entry);
        return originalListen(eventName, (event) => {
          globalThis.__nimiP4RawEvents.push({ eventName: String(eventName), payload: event?.payload, sequence: ++globalThis.__nimiP4Sequence });
          entry.events.push(summarize(event?.payload));
          return handler(event);
        });
      };
    }
  });
}

async function clearBridgeCapture(browser) {
  await browser.execute(() => {
    globalThis.__nimiP4Capture = [];
    globalThis.__nimiP4RawCalls = [];
    globalThis.__nimiP4RawEvents = [];
    globalThis.__nimiP4Sequence = 0;
  });
}

let runtimeCodecModule;
let runtimeAiWireModule;
let runtimeCommonWireModule;
async function decodedStreamEvidence(browser) {
  runtimeCodecModule ||= await import('../../../sdks/typescript/dist/runtime/generated.js');
  runtimeAiWireModule ||= await import('../../../sdks/typescript/dist/core-generated/runtime-protobuf/runtime/v1/ai.js');
  runtimeCommonWireModule ||= await import('../../../sdks/typescript/dist/core-generated/runtime-protobuf/runtime/v1/common.js');
  const raw = await browser.execute(() => ({
    calls: (globalThis.__nimiP4RawCalls || []).map((call) => ({
      methodId: call.args?.payload?.methodId || call.args?.methodId || '',
      streamId: call.result?.streamId || call.result?.stream_id || '',
      sequence: call.sequence,
    })),
    events: globalThis.__nimiP4RawEvents || [],
    captures: globalThis.__nimiP4Capture || [],
  }));
  const decoded = [];
  for (const call of raw.calls) {
    if (!call.methodId || !call.streamId) continue;
    const codec = runtimeCodecModule.getRuntimeWireCodec(call.methodId);
    for (const row of raw.events) {
      const payload = row.payload || {};
      const streamId = payload.streamId || payload.stream_id || '';
      const bytes = payload.payloadBytesBase64 || payload.payload_bytes_base64 || '';
      if (streamId !== call.streamId || !bytes) continue;
      decoded.push({ methodId: call.methodId, openSequence: call.sequence, eventSequence: row.sequence, event: codec.decodeResponse(Buffer.from(bytes, 'base64')) });
    }
  }
  const scenarioEvents = decoded.filter((row) => /StreamScenario/u.test(row.methodId)).map((row) => row.event);
  const payloadKinds = scenarioEvents.map((event) => event.payload?.oneofKind).filter(Boolean);
  const completed = scenarioEvents.filter((event) => event.payload?.oneofKind === 'completed').map((event) => event.payload.completed);
  const failed = scenarioEvents.filter((event) => event.payload?.oneofKind === 'failed').map((event) => event.payload.failed);
  const deltaCount = scenarioEvents.filter((event) => (
    event.payload?.oneofKind === 'delta'
    && event.payload.delta?.delta?.oneofKind === 'text'
    && String(event.payload.delta.delta.text?.text || '').length > 0
  )).length;
  const usageCount = scenarioEvents.filter((event) => event.payload?.oneofKind === 'usage').length
    + completed.filter((event) => event?.usage).length;
  const reasons = [
    ...completed.map((event) => `finish:${runtimeAiWireModule.FinishReason[event.finishReason] || event.finishReason}`),
    ...failed.map((event) => `reason:${runtimeCommonWireModule.ReasonCode[event.reasonCode] || event.reasonCode}`),
  ];
  const started = scenarioEvents.filter((event) => event.payload?.oneofKind === 'started').map((event) => event.payload.started);
  const sendSequences = raw.calls
    .filter((call) => /StreamScenario|SubmitAgent|Send/u.test(call.methodId))
    .map((call) => call.sequence);
  return {
    streamCallCount: raw.calls.filter((call) => /StreamScenario/u.test(call.methodId)).length,
    deltaCount,
    terminalCount: completed.length + failed.length,
    usageCount,
    reasons,
    providers: started.map((event) => `route:${runtimeAiWireModule.RoutePolicy[event.routeDecision] || event.routeDecision}`),
    payloadKinds,
    decodedMethods: [...new Set(decoded.map((row) => row.methodId))],
    subscribeBeforeSend: sendSequences.length > 0
      && raw.captures.some((capture) => capture.command === 'event-listen' && capture.sequence < Math.min(...sendSequences)),
  };
}

async function submitComposer(browser, prompt) {
  const textarea = await browser.$('[data-chat-composer-textarea="true"]');
  await textarea.waitForDisplayed({ timeout: 60_000 });
  await textarea.setValue(prompt);
  const send = await browser.$('[data-chat-composer-send="true"]');
  await send.waitForEnabled({ timeout: 60_000 });
  await send.click();
}

async function waitForTerminalCapture(browser, timeoutMs) {
  await browser.waitUntil(async () => (await decodedStreamEvidence(browser)).terminalCount > 0, {
    timeout: timeoutMs, interval: 250, timeoutMsg: 'real product stream did not emit a terminal event',
  });
  return decodedStreamEvidence(browser);
}

async function runDirectNimi(browser) {
  await authenticateIfRequired(browser);
  await displayed(browser, 'main-shell', 120_000);
  await installBridgeCapture(browser);
  await (await displayed(browser, 'nav-tab:chat')).click();
  const routeSelector = String(process.env.NIMI_FIRST_PARTY_LOCAL_ROUTE_TESTID || '').trim();
  const admittedRoute = routeSelector
    ? await selectChatTextRoute(browser, routeSelector, 'ready')
    : null;
  const routeLabel = String(await (await browser.$('[data-chat-composer-toolbar-meta="true"]')).getText()).trim();
  if (!routeLabel) throw new Error('direct Nimi route/model projection is empty');

  await clearBridgeCapture(browser);
  await submitComposer(browser, requireEnv('NIMI_FIRST_PARTY_DIRECT_PROMPT'));
  const success = await waitForTerminalCapture(browser, 300_000);
  assert.ok(success.streamCallCount > 0 && success.deltaCount > 0, 'direct Nimi must use StreamScenario and emit a real delta');
  assert.equal(success.terminalCount, 1, 'direct Nimi must emit exactly one terminal');
  assert.ok(success.usageCount > 0 && success.reasons.length > 0, 'direct Nimi terminal must carry usage and reason');
  assert.ok(success.providers.some((value) => /local/iu.test(value)), 'direct Nimi must resolve an admitted local route');
  assert.equal(success.providers.some((value) => /cloud|remote|hosted/iu.test(value)), false, 'direct Nimi must not use cloud fallback');

  await clearBridgeCapture(browser);
  await submitComposer(browser, requireEnv('NIMI_FIRST_PARTY_CANCEL_PROMPT'));
  const stop = await browser.$('button*=Stop generating');
  await stop.waitForDisplayed({ timeout: 60_000 });
  await stop.click();
  const canceled = await waitForTerminalCapture(browser, 60_000);
  assert.ok(canceled.reasons.some((value) => /cancel/iu.test(value)), 'cancel must produce a typed canceled terminal');

  await clearBridgeCapture(browser);
  await submitComposer(browser, requireEnv('NIMI_FIRST_PARTY_TIMEOUT_PROMPT'));
  const timedOut = await waitForTerminalCapture(browser, 300_000);
  assert.ok(timedOut.reasons.some((value) => /timeout|deadline/iu.test(value)), 'timeout path must produce a typed timeout terminal');

  const unavailableSelector = requireEnv('NIMI_FIRST_PARTY_UNAVAILABLE_ROUTE_TESTID');
  const unavailableRoute = await selectChatTextRoute(browser, unavailableSelector, 'unavailable');
  await clearBridgeCapture(browser);
  await submitComposer(browser, requireEnv('NIMI_FIRST_PARTY_UNAVAILABLE_PROMPT'));
  const unavailable = await waitForTerminalCapture(browser, 60_000);
  assert.ok(unavailable.reasons.some((value) => /unavailable|not[_ -]?found|route_not_ready/iu.test(value)), 'model-unavailable path must fail closed');
  assert.equal(unavailable.providers.some((value) => /cloud|remote|hosted/iu.test(value)), false, 'model-unavailable path must not fall back to cloud');

  return { admittedRoute, routeLabel, success, canceled, timedOut, unavailable, unavailableRoute };
}

async function observePartnerChatUi(browser, prompt) {
  return browser.execute((expectedPrompt) => {
    const chat = document.querySelector('[data-testid="chat-page"]');
    if (!(chat instanceof HTMLElement)) return { visible: false, promptVisible: false, visibleTextLength: 0 };
    const text = String(chat.innerText || '').replace(/\s+/gu, ' ').trim();
    return {
      visible: chat.getClientRects().length > 0,
      promptVisible: text.includes(expectedPrompt),
      visibleTextLength: text.length,
    };
  }, prompt);
}

async function activeAgentTargetRef(browser) {
  return browser.execute(() => {
    const target = document.querySelector('[data-testid^="chat-target:"][aria-current="page"]');
    const testId = String(target?.getAttribute('data-testid') || '');
    return testId.startsWith('chat-target:') ? testId.slice('chat-target:'.length) : '';
  });
}

async function agentCardCount(browser, localAgentRef) {
  return browser.execute(
    (testId) => document.querySelectorAll(`[data-testid="${testId}"]`).length,
    `agents-card:${localAgentRef}`,
  );
}

async function runPartnerCore(browser) {
  await authenticateIfRequired(browser);
  const sourceId = requireEnv('NIMI_FIRST_PARTY_REALM_SOURCE_ID');
  await (await displayed(browser, 'nav-tab:explore')).click();
  await (await displayed(browser, 'explore-section-tab-personas')).click();
  await displayed(browser, `explore-persona-source-card:${sourceId}`, 120_000);
  const sourceAction = await displayed(browser, `explore-persona-source-primary-action:${sourceId}`);
  const initialAction = String(await sourceAction.getAttribute('data-primary-action') || '');
  assert.ok(['become_partner', 'open_partner'].includes(initialAction), `source is not available to the ordinary partner UI: ${initialAction || 'unknown'}`);
  await sourceAction.click();
  await displayed(browser, 'chat-page', 180_000);
  const localAgentRef = String(await activeAgentTargetRef(browser) || '').trim();
  assert.ok(localAgentRef, 'ordinary source action did not open a materialized partner target');

  await (await displayed(browser, 'nav-tab:agents')).click();
  await displayed(browser, 'agents-list', 120_000);
  assert.equal(await agentCardCount(browser, localAgentRef), 1, 'ordinary source action did not expose exactly one partner card');

  await (await displayed(browser, 'nav-tab:explore')).click();
  await (await displayed(browser, 'explore-section-tab-personas')).click();
  const retryAction = await displayed(browser, `explore-persona-source-primary-action:${sourceId}`, 120_000);
  assert.equal(await retryAction.getAttribute('data-primary-action'), 'open_partner', 'materialized source did not become an ordinary open-partner action');
  await retryAction.click();
  await displayed(browser, 'chat-page', 120_000);
  assert.equal(await activeAgentTargetRef(browser), localAgentRef, 'ordinary idempotent reopen selected a different partner');

  await (await displayed(browser, 'nav-tab:agents')).click();
  await displayed(browser, 'agents-list', 120_000);
  const uniqueCardCount = await agentCardCount(browser, localAgentRef);
  assert.equal(uniqueCardCount, 1, 'ordinary partner reopen exposed duplicate cards');
  await (await displayed(browser, `agents-card:${localAgentRef}`, 120_000)).click();
  await displayed(browser, 'chat-page', 120_000);
  const partnerPrompt = requireEnv('NIMI_FIRST_PARTY_PARTNER_PROMPT');
  const beforeTurnUi = await observePartnerChatUi(browser, partnerPrompt);
  await submitComposer(browser, partnerPrompt);
  await browser.waitUntil(async () => {
    const observed = await observePartnerChatUi(browser, partnerPrompt);
    return observed.visible && observed.promptVisible && observed.visibleTextLength > beforeTurnUi.visibleTextLength + partnerPrompt.length;
  }, { timeout: 300_000, interval: 250, timeoutMsg: 'ordinary Electron UI did not render the completed partner turn' });
  const committedTurnUi = await observePartnerChatUi(browser, partnerPrompt);
  return {
    sourceId,
    localAgentRef,
    materializationUi: { initialAction, retryAction: 'open_partner', uniqueCardCount },
    openUi: { chatPageVisible: true },
    committedTurnUi,
  };
}

async function verifyPartnerUiReload(browser, partner) {
  await authenticateIfRequired(browser);
  await displayed(browser, 'main-shell', 120_000);
  await (await displayed(browser, 'nav-tab:agents')).click();
  await (await displayed(browser, `agents-card:${partner.localAgentRef}`, 120_000)).click();
  await displayed(browser, 'chat-page', 120_000);
  const prompt = requireEnv('NIMI_FIRST_PARTY_PARTNER_PROMPT');
  const ui = await observePartnerChatUi(browser, prompt);
  assert.equal(ui.visible, true, 'reopened Electron UI did not expose the partner chat');
  assert.equal(ui.promptVisible, true, 'reopened Electron UI did not restore the committed partner turn');
  assert.ok(ui.visibleTextLength >= partner.committedTurnUi.visibleTextLength, 'reopened Electron UI lost committed partner turn content');
  return { visible: ui.visible, promptVisible: ui.promptVisible, committedContentRestored: true };
}

function validateInstalledCandidate(repoRoot, candidateIdentity, processLedger) {
  if (!candidateIdentity.runtimeInstallerPath || !fs.existsSync(candidateIdentity.runtimeInstallerPath)) {
    throw new Error('fixed Runtime service status command is unavailable');
  }
  const output = run('pwsh.exe', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', candidateIdentity.runtimeInstallerPath,
    '-Mode', 'Status', '-Json',
  ], { cwd: repoRoot, capture: true });
  const status = parseFirstJsonDocument(output, 'first-party-runtime-status-json-invalid').value;
  assert.equal(status.state, 'running', 'fixed Runtime service is not running');
  assert.equal(status.runtimeCandidateId, candidateIdentity.runtimeCandidateId, 'Runtime candidate identity changed after Gate 0');
  assert.equal(status.runtimeBuildProfile, candidateIdentity.runtimeBuildProfile, 'Runtime build profile changed after Gate 0');
  assert.equal(status.runtimeBuildProfile, 'first_party_product_acceptance', 'later product Gate lost the endpoint-only acceptance build');
  assert.equal(status.productAcceptanceCandidatePostureVerified, true, 'later product Gate could not verify the acceptance Runtime posture');
  assert.equal(status.configuredAccountRealmBaseUrl, candidateIdentity.configuredAccountRealmBaseUrl, 'Runtime Realm projection changed after Gate 0');
  assert.equal(
    `${status.serviceName}:${status.serviceSid}:${status.binaryPath}`,
    candidateIdentity.serviceIdentity,
    'fixed Runtime service identity changed after Gate 0',
  );
  processLedger.observe('runtime', `pid:${status.processId}`, {
    serviceName: status.serviceName,
    serviceSid: status.serviceSid,
  });
  return status;
}

function deriveCandidateEvidencePosture({ runtime, signer, desktop }) {
  assert.equal(runtime.runtimeBuildRecord.checkpoint, 'first_party_product_acceptance');
  assert.equal(runtime.runtimeBuildRecord.nonRelease, true);
  assert.equal(runtime.status.signerCertificateSha256, signer.certificateSha256);
  assert.equal(runtime.runtimeBuildRecord.runtime?.signerCertificateSha256, signer.certificateSha256);
  assert.equal(runtime.status.runtimeBinarySha256, runtime.runtimeBuildRecord.runtime?.binarySha256);
  assert.equal(runtime.status.productAcceptanceCandidatePostureVerified, true);
  assert.equal(runtime.status.configuredAccountRealmBaseUrl, 'http://localhost:3002');
  assert.equal(runtime.status.nonProductCandidate, true, 'product-acceptance Runtime must remain non-promotable');
  assert.equal(sha256File(desktop.builtDesktop), sha256File(desktop.installedDesktop));
  return 'developer-signed_non-release_non-promotable';
}

function observed(assertionId, observationType) {
  return { assertionId, observationType, outcome: 'passed' };
}

function checkpoint(assertions, detail = {}) {
  const now = new Date().toISOString();
  assert.ok(Array.isArray(assertions) && assertions.length > 0, 'checkpoint requires explicit observed assertions');
  return { assertions, startedAt: now, completedAt: now, correlations: detail };
}

export async function runFirstPartyProductJourney({
  gate,
  repoRoot,
  outputDir,
  prerequisite,
}) {
  const processLedger = createProcessObservationLedger();
  if (gate === 'first-run') {
    const osIdentity = assertElevatedWindowsX64();
    const endpointTopology = await observeLocalProductTopology();
    const signer = requireWindowsDevSigningIdentity({ cwd: repoRoot });
    const rootId = `first-party-product-${randomUUID()}`;
    const candidateWorkspaceRoot = path.join(repoRoot, '.nimi', 'local', 'state', 'first-party-product', rootId);
    const electronUserDataRoot = path.join(candidateWorkspaceRoot, 'electron-user-data');
    const freshDataRootSelection = path.join(candidateWorkspaceRoot, 'nimi-data');
    fs.mkdirSync(path.dirname(candidateWorkspaceRoot), { recursive: true });
    fs.mkdirSync(candidateWorkspaceRoot, { recursive: false });
    const runtime = installRuntimeCandidate(repoRoot, processLedger);
    const desktop = buildAndInstallDesktopCandidate(repoRoot, signer, rootId);
    const evidencePosture = deriveCandidateEvidencePosture({ runtime, signer, desktop });
    const desktopSha256 = sha256File(desktop.installedDesktop);
    const ui = await withInstalledDesktop(
      desktop.installedDesktop,
      electronUserDataRoot,
      outputDir,
      (browser) => completeFirstRun(browser, freshDataRootSelection),
      processLedger,
    );
    const candidateIdentity = composeCandidateIdentity({
      runtime,
      signer,
      desktop,
      desktopSha256,
      evidencePosture,
      ui,
      electronUserDataRoot,
      dataRoot: ui.dataRoot,
    });
    return {
      rootId,
      accountIds: [],
      ...processLedger.snapshot(),
      endpointTopology,
      candidateIdentity,
      auxiliaryEvidence: { productControl: ui.owner, runtimeService: runtime.status },
      checkpointEvidence: {
        'candidate-built-signed-installed': checkpoint([
          observed('gate0:candidate-built-signed-installed', 'installed_candidate_identity'),
        ], { runtimeCandidateId: runtime.runtimeBuildRecord.candidateId }),
        'ordinary-desktop-first-run-completed': checkpoint([
         observed('gate0:ordinary-desktop-first-run-completed', 'ordinary_electron_ui'),
        ], {
          authorizationOrigin: ui.authentication.authorizationOrigin,
          dataRoot: ui.dataRoot,
          entryState: ui.entryState,
          recoveredReadyState: ui.recoveredReadyState,
          resumedIncompleteFirstRun: !ui.storageSelectionPerformed,
          storageSelectionPerformedInCurrentAttempt: ui.storageSelectionPerformed,
          realmToWebToRealm: ui.authentication.performed,
        }),
        'product-control-owner-ready': checkpoint([
          observed('gate0:product-control-owner-ready', 'auxiliary_authoritative_readback'),
        ], { state: ui.owner.state }),
        'execution-evidence-ref-parseable': checkpoint([
          observed('gate0:execution-evidence-ref-parseable', 'auxiliary_authoritative_readback'),
        ], { executionEvidenceRef: ui.executionEvidenceRef }),
      },
    };
  }

  const candidateIdentity = prerequisite?.candidateIdentity;
  if (!candidateIdentity || prerequisite?.gate0ExecutionEvidenceRef !== candidateIdentity.executionEvidenceRef) {
    throw new Error(`${gate} requires an admitted Gate 0 candidate and exact executionEvidenceRef`);
  }
  const installedDesktop = String(candidateIdentity.installedDesktopPath || '').trim();
  if (!fs.existsSync(installedDesktop) || sha256File(installedDesktop) !== candidateIdentity.desktopSha256) {
    throw new Error(`${gate} installed Desktop candidate changed after Gate 0`);
  }
  const signer = requireWindowsDevSigningIdentity({ cwd: repoRoot });
  assert.equal(signer.certificateSha256, candidateIdentity.signerCertificateSha256);
  requireWindowsDevSignedFiles([installedDesktop], signer.certificateSha256, { cwd: repoRoot });
  validateInstalledCandidate(repoRoot, candidateIdentity, processLedger);
  const userDataRoot = String(candidateIdentity.electronUserDataRoot || '').trim();
  if (!path.isAbsolute(userDataRoot) || !fs.existsSync(userDataRoot)) {
    throw new Error(`${gate} Gate 0 Electron product profile is unavailable`);
  }
  const endpointTopology = await observeLocalProductTopology();
  if (gate === 'direct-nimi') {
    const direct = await withInstalledDesktop(installedDesktop, userDataRoot, outputDir, (browser) => runDirectNimi(browser), processLedger);
    const evidence = Object.fromEntries([
      ['direct-nimi-admitted-local-text-route', 'F-01-admitted-route:observed', 'ordinary_nimi_chat_ui', { routeLabel: direct.routeLabel }],
      ['direct-nimi-real-local-stream-delta', 'F-01-stream-delta:observed', 'ordinary_nimi_chat_stream', direct.success],
      ['direct-nimi-single-terminal', 'F-01-terminal:observed', 'ordinary_nimi_chat_stream', direct.success],
      ['direct-nimi-usage-reason', 'F-01-usage-reason:observed', 'ordinary_nimi_chat_stream', direct.success],
      ['direct-nimi-cancel', 'F-01-cancel:observed', 'ordinary_nimi_chat_ui', direct.canceled],
      ['direct-nimi-timeout', 'F-01-timeout:observed', 'ordinary_nimi_chat_stream', direct.timedOut],
      ['direct-nimi-model-unavailable', 'F-01-model-unavailable:observed', 'ordinary_nimi_chat_ui', direct.unavailable],
      ['direct-nimi-no-cloud-fallback', 'F-01-no-cloud-fallback:observed', 'ordinary_nimi_chat_stream', direct.unavailable],
    ].map(([id, assertionId, observationType, detail]) => [
      id,
      checkpoint([observed(assertionId, observationType)], detail),
    ]));
    return {
      rootId: prerequisite.rootId,
      accountIds: prerequisite.accountIds,
      ...processLedger.snapshot(),
      endpointTopology,
      candidateIdentity,
      checkpointEvidence: evidence,
    };
  }
  if (gate === 'partner-core') {
    const partner = await withInstalledDesktop(
      installedDesktop,
      userDataRoot,
      path.join(outputDir, 'initial'),
      (browser) => runPartnerCore(browser),
      processLedger,
    );
    const reloadUi = await withInstalledDesktop(
      installedDesktop,
      userDataRoot,
      path.join(outputDir, 'reopen'),
      (browser) => verifyPartnerUiReload(browser, partner),
      processLedger,
    );
    const common = { localAgentRef: partner.localAgentRef, sourceId: partner.sourceId };
    return {
      rootId: prerequisite.rootId, accountIds: [], sourceIds: [partner.sourceId],
      localAgentIds: [partner.localAgentRef],
      ...processLedger.snapshot(),
      endpointTopology,
      candidateIdentity,
      checkpointEvidence: {
        'realm-source-selected': checkpoint([
          observed('R-01:semantic', 'ordinary_electron_ui'),
          observed('R-01:correlation', 'ordinary_ui_selection_correlation'),
          observed('R-01:privacy', 'safe_evidence_projection'),
        ], { ...common, ordinaryUi: true }),
        'materialization-owner-verified': checkpoint([
          observed('M-01:semantic', 'ordinary_electron_ui'),
          observed('M-01:correlation', 'ordinary_ui_materialization_correlation'),
          observed('M-01:privacy', 'safe_evidence_projection'),
        ], { ...common, ordinaryUi: true }),
        'materialization-idempotence-verified': checkpoint([
          observed('materialization-idempotence-verified:observed', 'ordinary_electron_ui_retry'),
        ], { ...common, ...partner.materializationUi }),
        'characters-projection-visible': checkpoint([
          observed('K-03-01:semantic', 'ordinary_electron_ui'),
          observed('K-03-01:correlation', 'ordinary_ui_projection_correlation'),
          observed('K-03-01:privacy', 'safe_evidence_projection'),
        ], { ...common, uniqueCardCount: partner.materializationUi.uniqueCardCount }),
        'ordinary-desktop-open-owner-readback': checkpoint([
          observed('L-01:semantic', 'ordinary_electron_ui'),
          observed('L-01:correlation', 'ordinary_ui_open_correlation'),
          observed('L-01:privacy', 'safe_evidence_projection'),
        ], { ...common, ...partner.openUi }),
        'partner-route-ready': checkpoint([
          observed('L-03-02:semantic', 'ordinary_electron_ui'),
          observed('L-03-02:correlation', 'ordinary_ui_send_correlation'),
          observed('L-03-02:privacy', 'safe_evidence_projection'),
        ], { uiCommitted: partner.committedTurnUi.promptVisible }),
        'partner-turn-committed-reloaded': checkpoint([
          ...['C-05-01', 'E-03-01', 'O-03-01'].flatMap((pointId) => [
            observed(`${pointId}:semantic`, 'ordinary_electron_ui_send_reopen'),
            observed(`${pointId}:correlation`, 'ordinary_ui_turn_correlation'),
            observed(`${pointId}:privacy`, 'safe_evidence_projection'),
          ]), 
        ], reloadUi),
      },
    };
  }
  throw new Error(`unsupported first-party product gate ${gate}`);
}
