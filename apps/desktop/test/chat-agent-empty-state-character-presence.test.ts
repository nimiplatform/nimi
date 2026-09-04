import assert from 'node:assert/strict';
import test from 'node:test';

import { i18n } from '../src/shell/renderer/i18n';
import {
  changeLocale,
  initI18n,
  liBaiRaw,
  ouYangDeRaw,
  toSourceDetailData,
} from './source-detail-world-character-test-utils.js';
import { toAgentEmptyStateCharacterPresence } from '../src/shell/renderer/features/chat/chat-agent-empty-state-character-presence.js';

test.before(async () => {
  await initI18n();
});

test('empty state presence carries greeting and character questions from the source', async () => {
  await changeLocale('zh');
  const source = toSourceDetailData(ouYangDeRaw, 'source_materialization_available');

  const presence = toAgentEmptyStateCharacterPresence(source, i18n.t.bind(i18n));

  assert.ok(presence);
  assert.equal(presence.greeting, '吾乃欧阳德，字崇一，号南野。');
  assert.ok(presence.questions.length > 0 && presence.questions.length <= 2);
  assert.ok(presence.questions.some((question) => question.includes('阳明学派')));
  assert.ok(presence.heroSubtitle);
  assert.equal(presence.referenceImageUrl, null);
  assert.equal(presence.voiceSampleUrl, null);
  assert.equal(presence.voiceSampleDurationSec, null);
});

test('empty state presence passes through portrait and voice sample', async () => {
  await changeLocale('zh');
  const source = toSourceDetailData({
    ...liBaiRaw,
    referenceImageUrl: 'https://example.com/li-bai.png',
    media: {
      assets: {
        voiceSample: {
          id: 'voice-1',
          kind: 'voiceSample',
          url: 'https://example.com/li-bai.mp3',
          durationSec: 25,
        },
      },
    },
  }, 'source_materialization_available');

  const presence = toAgentEmptyStateCharacterPresence(source, i18n.t.bind(i18n));

  assert.ok(presence);
  assert.equal(presence.referenceImageUrl, 'https://example.com/li-bai.png');
  assert.equal(presence.voiceSampleUrl, 'https://example.com/li-bai.mp3');
  assert.equal(presence.voiceSampleDurationSec, 25);
  assert.equal(presence.greeting, null);
});

test('empty state presence is null when the source has no usable presence', async () => {
  await changeLocale('zh');
  const source = toSourceDetailData({
    ...liBaiRaw,
    characterProfile: {
      ...liBaiRaw.characterProfile,
      role: '',
      archetype: '',
      traits: [],
      knowledgeTopics: [],
      knowledgeConstraints: [],
      interactionModes: [],
      milestones: [],
      relationshipNotes: [],
      conversationAnchors: [],
      interaction: null,
    },
    source: undefined,
    relationships: [],
  }, 'source_materialization_available');

  const presence = toAgentEmptyStateCharacterPresence(source, i18n.t.bind(i18n));

  assert.equal(presence, null);
});

test('empty state presence is null for non world character sources', async () => {
  await changeLocale('zh');
  const source = toSourceDetailData({
    ...liBaiRaw,
    sourceKind: 'personaCharacter',
    sourceId: 'persona-li-bai',
    sourceRef: {
      kind: 'personaCharacter',
      id: 'persona-li-bai',
      worldId: liBaiRaw.worldId,
      ownerAccountId: 'account-li-bai',
      sourceHash: liBaiRaw.sourceHash,
    },
  }, 'source_materialization_available');

  const presence = toAgentEmptyStateCharacterPresence(source, i18n.t.bind(i18n));

  assert.equal(presence, null);
});
