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
import { buildWorldCharacterQuestions } from '../src/shell/renderer/features/source-detail/source-detail-world-character-questions.js';

test.before(async () => {
  await initI18n();
});

test('world character questions drop untranslated machine slugs from persona fields', async () => {
  await changeLocale('zh');
  const source = toSourceDetailData({
    ...liBaiRaw,
    characterProfile: {
      ...liBaiRaw.characterProfile,
      interactionModes: ['dialogue', 'scene-grounded-greeting', 'historical-context', '诗文问答'],
    },
  }, 'source_materialization_available');

  const questions = buildWorldCharacterQuestions(source, i18n.t.bind(i18n));

  assert.ok(questions.length > 0);
  assert.ok(questions.some((question) => question.includes('诗文问答')));
  for (const question of questions) {
    assert.ok(!question.includes('dialogue'), question);
    assert.ok(!question.includes('scene-grounded-greeting'), question);
    assert.ok(!question.includes('historical-context'), question);
  }
});

test('world character questions keep localized closed-set persona codes', async () => {
  await changeLocale('zh');
  const source = toSourceDetailData({
    ...liBaiRaw,
    characterProfile: {
      ...liBaiRaw.characterProfile,
      interactionModes: ['conversation'],
    },
  }, 'source_materialization_available');

  const questions = buildWorldCharacterQuestions(source, i18n.t.bind(i18n));

  assert.ok(questions.some((question) => question.includes('对话')));
});

test('world character questions drop work titles that read as database labels', async () => {
  await changeLocale('zh');
  const source = toSourceDetailData(liBaiRaw, 'source_materialization_available');

  const questions = buildWorldCharacterQuestions(source, i18n.t.bind(i18n));

  assert.ok(questions.some((question) => question.includes('李太白集')));
  for (const question of questions) {
    assert.ok(!question.includes('草堂集'), question);
  }
});

test('world character questions filter raw CBDB relationship templates from suggestions', async () => {
  await changeLocale('zh');
  const source = toSourceDetailData({
    ...ouYangDeRaw,
    displayName: '同恕',
    entity: {
      ...ouYangDeRaw.entity,
      name: '同恕',
    },
    characterProfile: {
      ...ouYangDeRaw.characterProfile,
      role: '思想家、书院山长',
      archetype: '元代文人书院网络',
      traits: ['书院山长、太子左赞善'],
      interactionModes: ['书院雅集', '朝廷议事', '文人交游'],
    },
    relationships: [
      {
        id: 'raw-association-farewell',
        type: 'association',
        core: {
          attributes: {
            sourceRelationLabelChn: '临别得到Y所作赠言（送别诗、序）',
          },
        },
      },
      {
        id: 'raw-association-occasion',
        type: 'association',
        core: {
          attributes: {
            sourceRelationLabel: '从Y处收到贺词（occasion）',
          },
        },
      },
      {
        id: 'raw-association-image-record',
        type: 'association',
        core: {
          attributes: {
            sourceRelationLabelChn: '画赞（图像记）由Y所作',
          },
        },
      },
    ],
  }, 'source_materialization_available');

  const questions = buildWorldCharacterQuestions(source, i18n.t.bind(i18n));
  const joined = questions.join('\n');

  assert.ok(questions.includes('你为什么被称为思想家、书院山长？'));
  assert.ok(questions.includes('你会如何解释元代文人书院网络？'));
  assert.ok(questions.includes('你会如何解释书院山长、太子左赞善？'));
  assert.ok(questions.includes('你会如何解释书院雅集？'));
  assert.doesNotMatch(joined, /Y所作|occasion|图像记|送别诗、序|你和临别|你和从Y处|你和画赞/);
});
