export const DESKTOP_OPEN_TEST_LAUNCHER_APP_ID = 'nimi.desktop-open-test-launcher';

export const DESKTOP_OPEN_TEST_HOSTS = [
  {
    rowId: 'owner.generic-electron-host',
    sourceHost: 'electron-standard-shell',
    appId: DESKTOP_OPEN_TEST_LAUNCHER_APP_ID,
    hostClass: 'generic-standard-shell',
  },
  {
    rowId: 'owner.generic-tauri-host',
    sourceHost: 'tauri-standard-shell',
    appId: DESKTOP_OPEN_TEST_LAUNCHER_APP_ID,
    hostClass: 'generic-standard-shell',
  },
  {
    rowId: 'owner.installed-app-source-host',
    sourceHost: 'desktop-electron-installed-app-host',
    appId: DESKTOP_OPEN_TEST_LAUNCHER_APP_ID,
    hostClass: 'installed-nimi-app-standard-shell-v1',
  },
];

export const DESKTOP_OPEN_TEST_TARGETS = [
  {
    rowId: 'target.explore-worlds-section',
    request: { intent: { kind: 'open-explore', section: 'worlds' } },
    expected: { appliedTarget: 'open-explore', activeTab: 'explore', section: 'worlds' },
  },
  {
    rowId: 'target.explore-worlds',
    request: { intent: { kind: 'open-explore', section: 'worlds', productIntent: 'discover-worlds' } },
    expected: { appliedTarget: 'open-explore', activeTab: 'explore', section: 'worlds' },
  },
  {
    rowId: 'target.explore-personas-section',
    request: { intent: { kind: 'open-explore', section: 'personas' } },
    expected: { appliedTarget: 'open-explore', activeTab: 'explore', section: 'personas' },
  },
  {
    rowId: 'target.explore-personas',
    request: { intent: { kind: 'open-explore', section: 'personas', productIntent: 'select-partner' } },
    expected: { appliedTarget: 'open-explore', activeTab: 'explore', section: 'personas' },
  },
  {
    rowId: 'target.explore-personas-discover',
    request: { intent: { kind: 'open-explore', section: 'personas', productIntent: 'discover-personas' } },
    expected: { appliedTarget: 'open-explore', activeTab: 'explore', section: 'personas' },
  },
  {
    rowId: 'target.explore-activity-section',
    request: { intent: { kind: 'open-explore', section: 'activity' } },
    expected: { appliedTarget: 'open-explore', activeTab: 'explore', section: 'activity' },
  },
  {
    rowId: 'target.explore-activity',
    request: { intent: { kind: 'open-explore', section: 'activity', productIntent: 'view-activity' } },
    expected: { appliedTarget: 'open-explore', activeTab: 'explore', section: 'activity' },
  },
  {
    rowId: 'target.explore-search',
    request: { intent: { kind: 'open-explore', section: 'personas', query: 'mentor' } },
    expected: { appliedTarget: 'open-explore', activeTab: 'explore', section: 'personas', query: 'mentor' },
  },
  {
    rowId: 'target.runtime-connector',
    request: { intent: { kind: 'open-runtime-config', page: 'cloud', action: 'add-connector' } },
    expected: { appliedTarget: 'open-runtime-config', activeTab: 'runtime', page: 'cloud' },
  },
  {
    rowId: 'target.runtime-model',
    request: { intent: { kind: 'open-runtime-config', page: 'models', action: 'install-model' } },
    expected: { appliedTarget: 'open-runtime-config', activeTab: 'runtime', page: 'models' },
  },
  {
    rowId: 'target.agents-inventory',
    request: { intent: { kind: 'open-agents', view: 'inventory' } },
    expected: { appliedTarget: 'open-agents', activeTab: 'agents' },
  },
  {
    rowId: 'target.apps-surface',
    request: { intent: { kind: 'open-apps' } },
    expected: { appliedTarget: 'open-apps', activeTab: 'apps' },
  },
  {
    rowId: 'target.app-selection',
    request: { intent: { kind: 'open-apps', appId: 'nimi.example' } },
    expected: { appliedTarget: 'open-apps', activeTab: 'apps', appId: 'nimi.example' },
  },
  {
    rowId: 'target.settings-profile',
    request: { intent: { kind: 'open-settings', section: 'profile' } },
    expected: { appliedTarget: 'open-settings', activeTab: 'settings', section: 'profile' },
  },
];

export function createDesktopOpenTestLauncher(input) {
  const openDesktopIntent = input?.openDesktopIntent;
  if (typeof openDesktopIntent !== 'function') {
    throw new TypeError('desktop-open test launcher requires an openDesktopIntent harness.');
  }
  return {
    hosts: DESKTOP_OPEN_TEST_HOSTS,
    targets: DESKTOP_OPEN_TEST_TARGETS,
    async openTarget(rowId) {
      const target = DESKTOP_OPEN_TEST_TARGETS.find((entry) => entry.rowId === rowId);
      if (!target) {
        throw new Error(`unknown Desktop Open target fixture row: ${rowId}`);
      }
      const result = await openDesktopIntent(target.request);
      return {
        rowId: target.rowId,
        request: target.request,
        expected: target.expected,
        result,
      };
    },
  };
}

export async function collectDesktopOpenFixtureEvidence(input) {
  const launcher = createDesktopOpenTestLauncher(input);
  const rows = [];
  for (const target of launcher.targets) {
    rows.push(await launcher.openTarget(target.rowId));
  }
  return {
    fixtureId: 'desktop-open-test-launcher',
    appId: DESKTOP_OPEN_TEST_LAUNCHER_APP_ID,
    hosts: launcher.hosts,
    rows,
  };
}
