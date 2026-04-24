import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const postCardSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/features/home/post-card.tsx'),
  'utf8',
);
const postCardActionAdapterSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/features/home/post-card-action-adapter.tsx'),
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

test('post card action adapter uses real like/unlike/report/visibility APIs', () => {
  assert.match(postCardActionAdapterSource, /dataSync\.likePost\(/);
  assert.match(postCardActionAdapterSource, /dataSync\.unlikePost\(/);
  assert.match(postCardActionAdapterSource, /dataSync\.createReport\(/);
  assert.match(postCardActionAdapterSource, /dataSync\.updatePostVisibility\(/);
  assert.match(postCardSource, /actionAdapter\.likePost\(/);
  assert.match(postCardSource, /actionAdapter\.unlikePost\(/);
  assert.match(postCardSource, /actionAdapter\.createReport\(/);
  assert.match(postCardSource, /actionAdapter\.updatePostVisibility\(/);
});

test('report modal reason list matches backend enum contract', () => {
  assert.match(reportModalSource, /ReportReason\.SPAM/);
  assert.match(reportModalSource, /ReportReason\.NSFW/);
  assert.match(reportModalSource, /ReportReason\.HATE_SPEECH/);
  assert.match(reportModalSource, /ReportReason\.SCAM/);
  assert.match(reportModalSource, /ReportReason\.OTHER/);
});

test('report modal preserves failure feedback instead of silently closing on submit errors', () => {
  assert.match(reportModalSource, /const \[submitError, setSubmitError\] = useState<string \| null>\(null\)/);
  assert.match(reportModalSource, /catch \(error\)/);
  assert.match(reportModalSource, /setSubmitError/);
  assert.match(postCardSource, /ui\.setShowReportModal\(false\)/);
  assert.match(postCardSource, /throw error/);
});

test('edit post no longer shows coming soon path', () => {
  assert.doesNotMatch(postCardUiSource, /coming soon/i);
  assert.match(postCardUiSource, /setShowEditVisibilityModal\(true\)/);
});

test('post card does not keep an agent-chat unavailable branch in product UI', () => {
  assert.match(postCardSource, /showChatButton=\{post\.author\?\.isAgent !== true\}/);
  assert.doesNotMatch(postCardSource, /agentChatUnavailableFromMoments/);
});

test('post card is projection-only and consumes explicit owner adapters', () => {
  assert.match(postCardSource, /actionAdapter:\s*PostCardActionAdapter/);
  assert.doesNotMatch(postCardSource, /@runtime\/data-sync/);
  assert.doesNotMatch(postCardSource, /dataSync\./);
  assert.doesNotMatch(postCardSource, /import\s+\{?\s*ContactDetailProfileModal\b/);
  assert.doesNotMatch(postCardSource, /import\s+\{?\s*SendGiftModal\b/);
  assert.doesNotMatch(postCardSource, /from\s+['"].*send-gift-modal/);
  assert.doesNotMatch(postCardSource, /import\s+\{?\s*CreatePostModal\b/);
  assert.doesNotMatch(postCardSource, /from\s+['"].*create-post-modal(?:\.js)?['"]/);
  assert.doesNotMatch(postCardSource, /import\s+\{?\s*AddFriendModal\b/);
  assert.doesNotMatch(postCardSource, /from\s+['"].*add-friend-modal/);
});
