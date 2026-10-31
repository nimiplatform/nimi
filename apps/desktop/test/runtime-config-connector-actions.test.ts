import assert from 'node:assert/strict';
import test from 'node:test';
import { replaceConnectorsInState } from '../src/shell/renderer/features/runtime-config/runtime-config-connector-actions.js';
import { createDefaultStateV11 } from '../src/shell/renderer/features/runtime-config/runtime-config-storage-defaults.js';
import { normalizeConnectorV11, type ApiConnector } from '../src/shell/renderer/features/runtime-config/runtime-config-state-types.js';
import { runSelectedConnectorTestCommand } from '../src/shell/renderer/features/runtime-config/runtime-config-connector-test-command.js';
import type { RuntimeConfigConnectorSdkService } from '../src/shell/renderer/features/runtime-config/runtime-config-connector-sdk-service.js';
import { createInstance } from 'i18next';
import { readDesktopLocale } from './helpers/read-desktop-locale.js';
import { createRuntimeConfigPanelCommands } from '../src/shell/renderer/features/runtime-config/runtime-config-panel-commands.js';
import type { RuntimeConfigPanelCommandsInput } from '../src/shell/renderer/features/runtime-config/runtime-config-command-context.js';
import type { InlineFeedbackState } from '../src/shell/renderer/ui/feedback/inline-feedback.js';

const translations = createInstance();
await translations.init({ lng: 'zh', resources: {
  zh: { translation: readDesktopLocale('zh') },
  en: { translation: readDesktopLocale('en') },
} });

const inventory = normalizeConnectorV11({
  id: 'connection-1', provider: 'test-provider', vendor: 'test-provider',
  endpoint: 'https://provider.example/v1', label: 'My connection',
  hasCredential: true, scope: 'user', authMode: 'api_key',
});
const checked: ApiConnector = {
  ...inventory, status: 'healthy', lastCheckedAt: '2026-10-12T03:00:00Z', lastDetail: '',
  models: ['text-model'], modelCapabilities: { 'text-model': ['text.generate'] },
};
function stateWith(connector = checked) {
  return { ...createDefaultStateV11(), connectors: [connector] };
}

test('reloading inventory uses the persisted owner check', () => {
  const next = replaceConnectorsInState(stateWith(inventory), [{ ...checked, label: 'Renamed' }]);
  assert.deepEqual(next.connectors, [{ ...checked, label: 'Renamed' }]);
});

test('inventory refresh preserves owner failures and never revives an invalidated result', () => {
  const failed: ApiConnector = { ...checked, status: 'unreachable', lastDetail: 'Connection timed out' };
  assert.deepEqual(replaceConnectorsInState(stateWith(), [failed]).connectors, [failed]);
  assert.deepEqual(replaceConnectorsInState(stateWith(failed), [inventory]).connectors, [inventory]);
});

test('changed connection settings do not inherit the previous check', () => {
  const changes: Partial<ApiConnector>[] = [
    { provider: 'other-provider' }, { endpoint: 'https://other.example/v1' },
    { authMode: 'oauth_managed' }, { providerAuthProfile: 'other-profile' },
    { accountLabel: 'other-account' }, { scope: 'machine-global' },
    { hasCredential: false }, { isDraft: true },
  ];
  for (const patch of changes) {
    const changed = { ...inventory, ...patch };
    assert.deepEqual(replaceConnectorsInState(stateWith(), [changed]).connectors, [changed]);
  }
});

test('a fresh check replaces the old result and a save reset stays unchecked on refresh', () => {
  const fresh: ApiConnector = { ...checked, status: 'degraded', lastCheckedAt: '2026-10-12T04:00:00Z' };
  assert.deepEqual(replaceConnectorsInState(stateWith(), [fresh]).connectors, [fresh]);
  assert.deepEqual(replaceConnectorsInState(stateWith(inventory), [inventory]).connectors, [inventory]);
});

test('new and deleted connections follow runtime inventory without reviving old results', () => {
  const added = { ...inventory, id: 'connection-2' };
  const next = replaceConnectorsInState(stateWith(), [added]);
  assert.deepEqual(next.connectors, [added]);
  const empty = replaceConnectorsInState(stateWith(), []);
  assert.deepEqual(empty.connectors, []);
});

test('a delayed connection check cannot replace a newer configuration or observation', async () => {
  const selected: ApiConnector = { ...inventory, configurationVersion: 'version-1' };
  for (const replacement of [
    { ...selected, configurationVersion: 'version-2', endpoint: 'https://replacement.example/v1' },
    { ...selected, status: 'unreachable' as const, lastCheckedAt: '2026-10-27T04:00:00.000Z', lastDetail: 'AI_PROVIDER_AUTH_FAILED' },
  ]) {
    let state = stateWith(selected);
    let complete!: (value: ApiConnector) => void;
    const pending = runSelectedConnectorTestCommand({
      t: translations.getFixedT('zh'),
      state, selectedConnector: selected, now: Date.now,
      connectorSdk: { sdkTestConnector: () => new Promise<ApiConnector>(resolve => { complete = resolve; }) } as unknown as RuntimeConfigConnectorSdkService,
      updateState: update => { state = update(state); },
      setControlFeedback: () => {},
    });
    state = stateWith(replacement);
    complete({ ...selected, status: 'healthy', lastCheckedAt: '2026-10-27T03:00:00.000Z', lastDetail: '' });
    await pending;
    assert.deepEqual(state.connectors, [replacement]);
  }
});

test('connection checks deliver localized inline feedback and retain failure details', async () => {
  for (const locale of ['zh', 'en']) {
    for (const failure of [null, new Error('AI_PROVIDER_AUTH_FAILED'), new Error('Unexpected transport failure')]) {
      let state = stateWith(inventory);
      let busy = false;
      const feedback: (InlineFeedbackState | null)[] = [];
      const input = {
        guard: {
          get testingConnector() { return busy; },
          checkingHealth: false,
          setTestingConnector: (next: boolean) => { busy = next; },
          setCheckingHealth() {},
        },
        provider: { get health(): never { throw new Error('Connection checks must not invoke local health checks'); }, testSelectedConnector: {
          t: translations.getFixedT(locale),
          state,
          selectedConnector: inventory,
          get testingConnector() { return busy; },
          now: Date.now,
          connectorSdk: {
            sdkTestConnector: async () => { if (failure) throw failure; return checked; },
            sdkListConnectors: async () => [inventory],
          } as unknown as RuntimeConfigConnectorSdkService,
          updateState: (update: (previous: typeof state) => typeof state) => { state = update(state); },
          setStatusBanner() { assert.fail('check feedback belongs beside the connection'); },
        } },
      } satisfies RuntimeConfigPanelCommandsInput;
      await createRuntimeConfigPanelCommands(input).testSelectedConnector(value => feedback.push(value));
      assert.equal(busy, false);
      assert.equal(feedback[0], null, 'a new check clears the previous result');
      assert.equal(feedback.length, 2);
      const result = feedback[1]!;
      assert.equal(result.kind, failure ? 'error' : 'success');
      if (locale === 'zh') {
        assert.match(result.message, failure ? /验证未通过|检查未通过/ : /My connection 连接与凭证检查通过/);
        assert.doesNotMatch(result.message, /test passed|Connector test failed|AI_PROVIDER_AUTH_FAILED|Unexpected transport failure/);
      } else {
        assert.doesNotMatch(result.message, /[\u4e00-\u9fff]/);
        if (!failure) assert.match(result.message, /check passed for My connection/);
      }
      if (failure) assert.ok(result.technicalDetail?.includes(failure.message));
      else assert.equal(state.connectors[0]!.status, 'healthy');
    }
  }
});
