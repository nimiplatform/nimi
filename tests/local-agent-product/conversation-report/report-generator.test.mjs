import assert from 'node:assert/strict';
import test from 'node:test';

import { renderConversationReportHtml } from './report-generator.mjs';
import { createValidConversationReport } from './test-support.mjs';

test('report HTML exposes both complete LocalAgent transcripts and one lifecycle timeline', () => {
  const report = createValidConversationReport();
  const html = renderConversationReportHtml(report);
  assert.match(html, /WorldCharacter-source LocalAgent A 完整多轮对话/u);
  assert.match(html, /RealmPersona-source LocalAgent B 完整多轮对话/u);
  assert.match(html, /Cross-surface \/ cross-agent \/ restart \/ offline timeline/u);
  for (const turn of report.turns) {
    assert.match(html, new RegExp(turn.turnId, 'u'));
    assert.equal(html.includes(turn.user.content), true);
    assert.equal(html.includes(turn.assistant.content), true);
  }
  assert.match(html, /source kind\/ref/u);
  assert.match(html, /localAgentRef/u);
  assert.match(html, /conversationAnchorId/u);
  assert.match(html, /Runtime threadId/u);
  assert.match(html, /Public inference parameters/u);
  assert.match(html, /Environment starts/u);
  assert.match(html, /Mechanical finding details/u);
  assert.match(html, /review-voice-emotion-apml/u);
  assert.match(html, /Presentation capture/u);
  assert.doesNotMatch(html, /semantic PASS|semantic FAIL|style score|automatic accepted/iu);
  assert.equal(report.reviewStatus, 'unreviewed');
  assert.equal(report.reviewDimensions.every((dimension) => dimension.reviewStatus === 'unreviewed'
    && dimension.notes === ''), true);
});

test('report HTML includes foldable Runtime context and local artifact links', () => {
  const html = renderConversationReportHtml(createValidConversationReport());
  assert.match(html, /<details[^>]*>/u);
  assert.match(html, /provider-captures\//u);
  assert.match(html, /runtime-state\//u);
  assert.match(html, /screenshots\//u);
  assert.match(html, /<details><summary>Mechanical finding details<\/summary>/u);
});
