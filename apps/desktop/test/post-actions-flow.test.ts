import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const postCardSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/features/home/post-card.tsx'),
  'utf8',
);
const reportModalSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/features/home/report-modal.tsx'),
  'utf8',
);
const postCardUiSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/features/home/use-post-card-ui.ts'),
  'utf8',
);

test('post card uses real like/unlike/report/visibility APIs', () => {
  assert.match(postCardSource, /dataSync\.likePost\(/);
  assert.match(postCardSource, /dataSync\.unlikePost\(/);
  assert.match(postCardSource, /dataSync\.createReport\(/);
  assert.match(postCardSource, /dataSync\.updatePostVisibility\(/);
});

test('report modal reason list matches backend enum contract', () => {
  assert.match(reportModalSource, /ReportReason\.SPAM/);
  assert.match(reportModalSource, /ReportReason\.NSFW/);
  assert.match(reportModalSource, /ReportReason\.HATE_SPEECH/);
  assert.match(reportModalSource, /ReportReason\.SCAM/);
  assert.match(reportModalSource, /ReportReason\.OTHER/);
});

test('edit post no longer shows coming soon path', () => {
  assert.doesNotMatch(postCardUiSource, /coming soon/i);
  assert.match(postCardUiSource, /setShowEditVisibilityModal\(true\)/);
});

test('post card does not keep an agent-chat unavailable branch in product UI', () => {
  assert.match(postCardSource, /showChatButton=\{post\.author\?\.isAgent !== true\}/);
  assert.doesNotMatch(postCardSource, /agentChatUnavailableFromMoments/);
});
