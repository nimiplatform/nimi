import test from 'node:test';

import { assert, E2E_IDS, createBaseDriver, runDesktopMacosSmokeScenario, shouldStartDesktopMacosSmoke } from './desktop-macos-smoke-test-helpers';

test('desktop macos smoke only starts when bootstrap is ready and a scenario is enabled', () => {
  assert.equal(shouldStartDesktopMacosSmoke({
    bootstrapReady: true,
    context: { enabled: true, scenarioId: 'chat.memory-standard-bind' },
    alreadyStarted: false,
  }), true);

  assert.equal(shouldStartDesktopMacosSmoke({
    bootstrapReady: false,
    context: { enabled: true, scenarioId: 'chat.memory-standard-bind' },
    alreadyStarted: false,
  }), false);

  assert.equal(shouldStartDesktopMacosSmoke({
    bootstrapReady: true,
    context: { enabled: false, scenarioId: 'chat.memory-standard-bind' },
    alreadyStarted: false,
  }), false);

  assert.equal(shouldStartDesktopMacosSmoke({
    bootstrapReady: true,
    context: { enabled: true },
    alreadyStarted: false,
  }), false);

  assert.equal(shouldStartDesktopMacosSmoke({
    bootstrapReady: true,
    context: { enabled: true, scenarioId: 'chat.memory-standard-bind' },
    alreadyStarted: true,
  }), false);
});

test('desktop macos smoke chat memory bind scenario follows the expected step order', async () => {
  const clicked: string[] = [];
  const waited: string[] = [];
  const writtenReports: Array<Record<string, unknown>> = [];
  let modeReads = 0;

  await runDesktopMacosSmokeScenario('chat.memory-standard-bind', createBaseDriver({
    async waitForTestId(id) {
      waited.push(id);
    },
    async clickByTestId(id) {
      clicked.push(id);
    },
    async readAttributeByTestId(id, name) {
      assert.equal(id, E2E_IDS.chatMemoryModeStatus);
      assert.equal(name, 'data-memory-mode');
      modeReads += 1;
      if (modeReads <= 2) {
        return 'baseline';
      }
      return 'standard';
    },
    async readTextByTestId(id) {
      assert.equal(id, E2E_IDS.chatMemoryModeStatus);
      return '';
    },
    async writeReport(payload) {
      writtenReports.push(payload as unknown as Record<string, unknown>);
    },
    currentRoute() {
      return '/chat';
    },
    currentHtml() {
      return '<html>chat</html>';
    },
  }));

  assert.deepEqual(waited.slice(0, 2), [
    E2E_IDS.panel('chat'),
    E2E_IDS.chatMemoryModeStatus,
  ]);
  assert.deepEqual(clicked, [
    E2E_IDS.chatTarget('agent-e2e-alpha'),
    E2E_IDS.chatSettingsToggle,
    E2E_IDS.chatMemoryModeUpgradeButton,
    E2E_IDS.chatMemoryModeUpgradeButton,
  ]);
  assert.equal(writtenReports.length, 1);
  assert.deepEqual(writtenReports[0], {
    ok: true,
    steps: [
      'wait-chat-panel',
      'select-agent-target',
      'open-settings',
      'wait-baseline',
      'cancel-upgrade',
      'confirm-cancel-still-baseline',
      'confirm-upgrade',
      'wait-standard',
      'write-pass-report',
    ],
    route: '/chat',
    htmlSnapshot: '<html>chat</html>',
  });
});

test('desktop macos smoke tester speech bundle scenario follows the expected step order', async () => {
  const clicked: string[] = [];
  const waited: string[] = [];
  const writtenReports: Array<Record<string, unknown>> = [];

  await runDesktopMacosSmokeScenario('tester.speech-bundle-panels', createBaseDriver({
    async waitForTestId(id) {
      waited.push(id);
    },
    async clickByTestId(id) {
      clicked.push(id);
    },
    async writeReport(payload) {
      writtenReports.push(payload as unknown as Record<string, unknown>);
    },
    currentRoute() {
      return '/tester';
    },
    currentHtml() {
      return '<html>tester</html>';
    },
  }));

  assert.deepEqual(clicked, [
    E2E_IDS.navTab('tester'),
    E2E_IDS.testerCapabilityTab('audio.synthesize'),
    E2E_IDS.testerCapabilityTab('audio.transcribe'),
    E2E_IDS.testerCapabilityTab('voice.clone'),
    E2E_IDS.testerCapabilityTab('voice.design'),
  ]);
  assert.deepEqual(waited, [
    E2E_IDS.panel('tester'),
    E2E_IDS.testerPanel('audio.synthesize'),
    E2E_IDS.testerInput('audio-synthesize-text'),
    E2E_IDS.testerPanel('audio.transcribe'),
    E2E_IDS.testerInput('audio-transcribe-file'),
    E2E_IDS.testerPanel('voice.clone'),
    E2E_IDS.testerInput('voice-clone-file'),
    E2E_IDS.testerPanel('voice.design'),
    E2E_IDS.testerInput('voice-design-instruction'),
  ]);
  assert.equal(writtenReports.length, 1);
  assert.deepEqual(writtenReports[0], {
    ok: true,
    steps: [
      'open-tester-tab',
      'wait-tester-panel',
      'open-tts-panel',
      'wait-tts-input',
      'open-stt-panel',
      'wait-stt-input',
      'open-voice-clone-panel',
      'wait-voice-clone-input',
      'open-voice-design-panel',
      'wait-voice-design-input',
      'write-pass-report',
    ],
    route: '/tester',
    htmlSnapshot: '<html>tester</html>',
  });
});

