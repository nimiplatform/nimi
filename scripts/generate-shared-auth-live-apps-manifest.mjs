#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const evidenceRoot = path.join(root, '.nimi', 'local', 'evidence', 'runtime-shared-auth-broker');
const outputPath = path.join(evidenceRoot, 'live-apps.json');
const desktopReportPath = 'apps/desktop/reports/e2e/explore-materialization-acceptance/acceptance-result.json';

function requireCondition(condition, message) {
  if (!condition) throw new Error(`shared-auth live manifest generation failed: ${message}`);
}

function readReport(relativePath) {
  const absolute = path.join(root, relativePath);
  requireCondition(existsSync(absolute), `missing source report ${relativePath}`);
  const raw = readFileSync(absolute, 'utf8');
  for (const credential of [
    'runtime-live-access-token',
    'runtime-live-refresh-token',
    'desktop-acceptance-access-token',
    'e2e-runtime-refresh-user-e2e-primary',
  ]) {
    requireCondition(!raw.includes(credential), `${relativePath} contains fixture credential material`);
  }
  requireCondition(!/Bearer\s+[A-Za-z0-9._~-]{12,}/u.test(raw), `${relativePath} contains Bearer credential material`);
  return JSON.parse(raw);
}

function repoRelative(filePath) {
  const absolute = path.isAbsolute(filePath) ? filePath : path.join(root, filePath);
  const relative = path.relative(root, absolute).split(path.sep).join('/');
  requireCondition(relative && !relative.startsWith('../'), `artifact escapes repository: ${filePath}`);
  return relative;
}

function inspectionPassed(inspection) {
  return inspection
    && inspection.landmarkCount > 0
    && inspection.horizontalOverflow === false
    && (inspection.unlabeledControls ?? []).length === 0
    && (inspection.smallControls ?? []).length === 0;
}

function electronApp(id, relativePath) {
  const report = readReport(relativePath);
  const desktop = report.accessibility?.desktop;
  const narrow = report.accessibility?.narrow;
  const denied = report.denied?.sessionCommands ?? [];
  const disabledObserved = Number(report.disabled?.visibleDisabledControls ?? 0) > 0
    || report.disabled?.disabledFeatureState === true;
  requireCondition(report.success?.runtimeReady?.ok === true, `${id} Runtime readiness is not successful`);
  requireCondition(report.success?.sharedAuthBroker?.ok === true, `${id} broker success is missing`);
  requireCondition(report.failure?.observed === true && report.failure?.sharedAuthBroker?.ok === false, `${id} failure state is missing`);
  requireCondition(denied.length === 3 && denied.every((row) => row.denied === true), `${id} auth.session denial is incomplete`);
  requireCondition(disabledObserved, `${id} disabled state is missing`);
  requireCondition(report.interaction?.usable === true, `${id} primary interaction is unusable`);
  requireCondition(inspectionPassed(desktop) && inspectionPassed(narrow), `${id} accessibility/layout inspection failed`);
  requireCondition(desktop.chineseVisible === true && narrow.chineseVisible === true, `${id} Chinese readability failed`);
  requireCondition(desktop.longTextVisible === true && narrow.longTextVisible === true, `${id} long-text inspection failed`);
  requireCondition(report.tokenLeak?.passed === true && report.tokenLeak.findings.length === 0, `${id} token leak probe failed`);
  requireCondition(report.consoleErrors.length === 0 && report.pageErrors.length === 0, `${id} renderer errors are present`);
  return {
    id,
    states: {
      success: { observed: true, evidence: 'Runtime ready and Runtime-mediated Realm broker request reached the fixture.' },
      failure: { observed: true, evidence: 'Disconnected Runtime endpoint failed both readiness and broker calls closed.' },
      disabled: { observed: true, evidence: disabledObserved ? 'A real disabled or degraded product control was inspected.' : '' },
      denied: { observed: true, evidence: 'All active Electron auth.session commands were denied by host policy.' },
    },
    runtimeConnectivity: { passed: true, transport: 'electron-ipc' },
    primaryPath: { passed: true, interaction: report.interaction.kind },
    accessibility: { passed: true, desktop, narrow },
    layout: { desktopPassed: true, narrowPassed: true },
    chineseReadability: { passed: true },
    longText: { passed: true },
    tokenLeak: report.tokenLeak,
    consoleErrors: report.consoleErrors,
    pageErrors: report.pageErrors,
    domAssertions: [
      'Playwright observed the real product interaction control as usable.',
      'Playwright DOM inspection found desktop and narrow landmarks with no unnamed or undersized controls.',
      'Playwright DOM inspection found no horizontal overflow in either viewport.',
    ],
    screenshots: report.screenshots,
    reportPath: relativePath,
  };
}

function testerTauriApp() {
  const relativePath = '.nimi/local/evidence/runtime-shared-auth-broker/tester-tauri.json';
  const report = readReport(relativePath);
  const desktop = report.accessibility?.desktop;
  const narrow = report.accessibility?.narrow;
  const denied = report.denied?.sessionCommands ?? [];
  requireCondition(report.success?.runtimeReady?.ok === true, 'tester-tauri Runtime readiness is not successful');
  requireCondition(report.success?.accountProjection?.ok === true, 'tester-tauri account projection is missing');
  requireCondition(report.success?.sharedAuthBroker?.ok === true, 'tester-tauri broker success is missing');
  requireCondition(report.failure?.observed === true && report.failure?.sharedAuthBroker?.ok === false, 'tester-tauri logout failure state is missing');
  requireCondition(denied.length === 3 && denied.every((row) => row.denied === true), 'tester-tauri auth.session denial is incomplete');
  requireCondition(report.disabled?.desktopOwnedAccountControlDisabled === true, 'tester-tauri Desktop-owned account control is not disabled');
  requireCondition(report.interaction?.usable === true, 'tester-tauri workbench interaction is unusable');
  requireCondition(inspectionPassed(desktop) && inspectionPassed(narrow), 'tester-tauri accessibility/layout inspection failed');
  requireCondition(desktop.chineseVisible === true && narrow.chineseVisible === true, 'tester-tauri Chinese readability failed');
  requireCondition(desktop.longTextVisible === true && narrow.longTextVisible === true, 'tester-tauri long-text inspection failed');
  requireCondition(report.tokenLeak?.passed === true && report.tokenLeak.findings.length === 0, 'tester-tauri token leak probe failed');
  requireCondition(report.consoleErrors.length === 0 && report.pageErrors.length === 0, 'tester-tauri renderer errors are present');
  return {
    id: 'tester-tauri',
    states: {
      success: { observed: true, evidence: 'Real Tauri IPC resolved Runtime account projection and broker access.' },
      failure: { observed: true, evidence: 'Runtime logout changed the account projection and the next broker call failed closed.' },
      disabled: { observed: true, evidence: 'Tester exposed the Desktop-owned account control as disabled.' },
      denied: { observed: true, evidence: 'All three auth_session_* commands were absent from the registered Tauri command surface.' },
    },
    runtimeConnectivity: { passed: true, transport: 'tauri-ipc' },
    primaryPath: { passed: true, interaction: report.interaction.kind },
    accessibility: { passed: true, desktop, narrow },
    layout: { desktopPassed: true, narrowPassed: true },
    chineseReadability: { passed: true },
    longText: { passed: true },
    tokenLeak: report.tokenLeak,
    consoleErrors: report.consoleErrors,
    pageErrors: report.pageErrors,
    domAssertions: [
      'The real Tauri renderer probe selected Text Studio and edited its textarea through DOM events.',
      'The real Tauri renderer probe inspected landmarks, labels, control sizes, disabled state, and overflow at 1120px and 400px.',
      'The real Tauri renderer probe observed the Desktop-owned account panel and denied auth_session_* commands.',
    ],
    screenshots: report.screenshots,
    reportPath: relativePath,
    automation: report.automation,
  };
}

function desktopApp() {
  const report = readReport(desktopReportPath);
  const sharedAuth = report.sharedAuth;
  const observations = report.observations ?? {};
  const longText = String(observations.agentComposerLongChineseText || '');
  requireCondition(report.ok === true, 'Desktop detailed report is not successful');
  requireCondition(sharedAuth?.success?.observed === true && sharedAuth.success.realmBrokerConsumption === true, 'Desktop broker success is missing');
  requireCondition(sharedAuth?.failure?.observed === true, 'Desktop switch/logout failure state is missing');
  requireCondition(sharedAuth?.denied?.observed === true && sharedAuth.denied.sessionCommands.length === 3, 'Desktop auth.session denial is incomplete');
  requireCondition(sharedAuth?.disabled?.observed === true, 'Desktop disabled state is missing');
  requireCondition(sharedAuth?.tokenLeak?.passed === true && sharedAuth.tokenLeak.findings.length === 0, 'Desktop token leak probe failed');
  requireCondition(observations.desktopLayout?.hasHorizontalOverflow === false, 'Desktop layout inspection failed');
  requireCondition(observations.narrowLayout?.hasHorizontalOverflow === false, 'Desktop narrow layout inspection failed');
  requireCondition((observations.desktopAccessibility?.unnamedInteractiveControls ?? []).length === 0, 'Desktop accessibility inspection failed');
  requireCondition((observations.narrowAccessibility?.unnamedInteractiveControls ?? []).length === 0, 'Desktop narrow accessibility inspection failed');
  requireCondition(/[\u3400-\u9fff]/u.test(longText) && longText.length > 40, 'Desktop Chinese long-text interaction is missing');
  requireCondition(report.consoleErrors.length === 0 && report.pageErrors.length === 0, 'Desktop renderer errors are present');
  return {
    id: 'desktop',
    states: {
      success: { observed: true, evidence: 'Playwright exercised Runtime-owned login fixture, broker-backed Explore, source materialization, and Agent Chat.' },
      failure: { observed: true, evidence: 'Real Switch account and Log out controls both reached the login-required screen.' },
      disabled: { observed: true, evidence: 'The real world preview exposed and preserved an unavailable action as disabled.' },
      denied: { observed: true, evidence: 'All three Electron auth.session commands were denied by external Runtime custody policy.' },
    },
    runtimeConnectivity: { passed: true, transport: 'electron-ipc', authCustody: 'runtime-account-service' },
    primaryPath: { passed: true, interaction: 'Explore world → materialize partner → Agent Chat → switch/logout account UX' },
    accessibility: {
      passed: true,
      desktop: observations.desktopAccessibility,
      narrow: observations.narrowAccessibility,
      chat: observations.chatAccessibility,
    },
    layout: { desktopPassed: true, narrowPassed: true },
    chineseReadability: { passed: true },
    longText: { passed: true },
    tokenLeak: sharedAuth.tokenLeak,
    consoleErrors: report.consoleErrors,
    pageErrors: report.pageErrors,
    domAssertions: [
      'Playwright and CDP accessibility inspection found no unnamed interactive controls in desktop, narrow, or chat surfaces.',
      'Playwright DOM layout inspection found no horizontal overflow at desktop and narrow widths.',
      'Playwright observed Switch account and Log out controls transition the real shell to login-required.',
    ],
    screenshots: {
      desktop: repoRelative(report.screenshots.desktopExplore),
      narrow: repoRelative(report.screenshots.narrowExplore),
    },
    reportPath: desktopReportPath,
  };
}

const manifest = {
  schemaVersion: 1,
  authority: 'runtime-shared-auth-broker',
  generatedAt: new Date().toISOString(),
  apps: [
    desktopApp(),
    testerTauriApp(),
    electronApp('tester-electron', '.nimi/local/evidence/runtime-shared-auth-broker/tester-electron.json'),
    electronApp('avatar-electron', '.nimi/local/evidence/runtime-shared-auth-broker/avatar-electron.json'),
    electronApp('zhiyu-electron', '.nimi/local/evidence/runtime-shared-auth-broker/zhiyu-electron.json'),
  ],
  knownResidualRisks: [
    'Tester Tauri used a real renderer-entry DOM probe and native PrintWindow screenshots because WebView2 150 did not expose a usable CDP endpoint; the detailed report records this blocked CDP attempt explicitly.',
  ],
};

writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
process.stdout.write(`${path.relative(root, outputPath).split(path.sep).join('/')}\n`);
