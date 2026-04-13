import path from 'node:path';
import { fileURLToPath } from 'node:url';

const helperDir = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(helperDir, '..', '..');

export const scenarioRegistry = new Map([
  ['boot.anonymous.login-screen', { bucket: 'smoke', profile: 'boot.anonymous.login-screen.json', spec: 'apps/desktop/e2e/specs/boot.anonymous.login-screen.e2e.mjs' }],
  ['boot.authenticated.main-shell', { bucket: 'smoke', profile: 'boot.authenticated.main-shell.json', spec: 'apps/desktop/e2e/specs/boot.authenticated.main-shell.e2e.mjs' }],
  ['boot.runtime-unavailable.degraded-shell', { bucket: 'smoke', profile: 'boot.runtime-unavailable.degraded-shell.json', spec: 'apps/desktop/e2e/specs/boot.runtime-unavailable.degraded-shell.e2e.mjs' }],
  ['boot.fatal-error-screen', { bucket: 'smoke', profile: 'boot.fatal-error-screen.json', spec: 'apps/desktop/e2e/specs/boot.fatal-error-screen.e2e.mjs' }],
  ['shell.core-navigation', { bucket: 'smoke', profile: 'shell.core-navigation.json', spec: 'apps/desktop/e2e/specs/shell.core-navigation.e2e.mjs' }],
  ['offline.banner-and-recovery', { bucket: 'smoke', profile: 'offline.banner-and-recovery.json', spec: 'apps/desktop/e2e/specs/offline.banner-and-recovery.e2e.mjs' }],
  ['runtime.config-panel-load', { bucket: 'smoke', profile: 'runtime.config-panel-load.json', spec: 'apps/desktop/e2e/specs/runtime.config-panel-load.e2e.mjs' }],
  ['settings.release-strip-and-preferences', { bucket: 'journeys', profile: 'settings.release-strip-and-preferences.json', spec: 'apps/desktop/e2e/specs/settings.release-strip-and-preferences.e2e.mjs' }],
  ['chat.open-thread', { bucket: 'journeys', profile: 'chat.open-thread.json', spec: 'apps/desktop/e2e/specs/chat.open-thread.e2e.mjs' }],
  ['chat.memory-standard-bind', { bucket: 'journeys', profile: 'chat.memory-standard-bind.json', spec: 'apps/desktop/e2e/specs/chat.memory-standard-bind.e2e.mjs' }],
  ['mods.panel-open', { bucket: 'journeys', profile: 'mods.panel-open.json', spec: 'apps/desktop/e2e/specs/mods.panel-open.e2e.mjs' }],
  ['contacts.panel-load', { bucket: 'journeys', profile: 'contacts.panel-load.json', spec: 'apps/desktop/e2e/specs/contacts.panel-load.e2e.mjs' }],
  ['explore.panel-load', { bucket: 'journeys', profile: 'explore.panel-load.json', spec: 'apps/desktop/e2e/specs/explore.panel-load.e2e.mjs' }],
  ['explore.feed-profile-modal', { bucket: 'journeys', profile: 'explore.feed-profile-modal.json', spec: 'apps/desktop/e2e/specs/explore.feed-profile-modal.e2e.mjs' }],
  ['runtime.local-ai.panel-load', { bucket: 'journeys', profile: 'runtime.local-ai.panel-load.json', spec: 'apps/desktop/e2e/specs/runtime.local-ai.panel-load.e2e.mjs' }],
  ['runtime.external-agent.panel-load', { bucket: 'journeys', profile: 'runtime.external-agent.panel-load.json', spec: 'apps/desktop/e2e/specs/runtime.external-agent.panel-load.e2e.mjs' }],
]);

export function profilePathForScenario(scenarioId) {
  const entry = scenarioRegistry.get(scenarioId);
  if (!entry) {
    throw new Error(`unknown E2E scenario: ${scenarioId}`);
  }
  return path.join(desktopRoot, 'e2e', 'fixtures', 'profiles', entry.profile);
}

export function selectScenarios(options) {
  if (options.scenario) {
    if (!scenarioRegistry.has(options.scenario)) {
      throw new Error(`unknown E2E scenario: ${options.scenario}`);
    }
    return [options.scenario];
  }
  if (options.suite === 'smoke') {
    return Array.from(scenarioRegistry.entries())
      .filter(([, item]) => item.bucket === 'smoke')
      .map(([scenario]) => scenario);
  }
  if (options.suite === 'journeys') {
    return Array.from(scenarioRegistry.entries())
      .filter(([, item]) => item.bucket === 'journeys')
      .map(([scenario]) => scenario);
  }
  return Array.from(scenarioRegistry.keys());
}
