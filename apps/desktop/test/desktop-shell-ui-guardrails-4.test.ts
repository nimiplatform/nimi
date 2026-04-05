import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(import.meta.dirname, relativePath), 'utf8');
}

const giftBubbleSource = readSource('../src/shell/renderer/features/economy/gift-message-bubble.tsx');
const hydrationSource = readSource('../src/shell/renderer/features/runtime-config/runtime-config-effect-hydration.ts');
const modHubControllerSource = readSource('../src/shell/renderer/features/mod-hub/mod-hub-controller.ts');
const connectorDiscoverySource = readSource('../src/shell/renderer/features/runtime-config/runtime-config-connector-discovery.ts');
const createPostModalSource = readSource('../src/shell/renderer/features/profile/create-post-modal.tsx');

test('gift message bubble surfaces accept/reject failures instead of silently swallowing them', () => {
  assert.match(giftBubbleSource, /const \[feedback, setFeedback\] = useState<InlineFeedbackState \| null>\(null\)/);
  assert.match(giftBubbleSource, /<InlineFeedback feedback=\{feedback\} onDismiss=\{\(\) => setFeedback\(null\)\} \/>/);
  assert.match(giftBubbleSource, /t\('GiftBubble\.acceptFailed', \{ defaultValue: 'Failed to accept gift' \}\)/);
  assert.match(giftBubbleSource, /t\('GiftBubble\.rejectFailed', \{ defaultValue: 'Failed to reject gift' \}\)/);
  assert.doesNotMatch(giftBubbleSource, /silently ignore/);
});

test('runtime config hydration banner is localized instead of hardcoded Chinese text', () => {
  assert.match(hydrationSource, /i18n\.t\('RuntimeConfig\.structureUpgraded'/);
  assert.doesNotMatch(hydrationSource, /配置结构已升级，请重新确认模型绑定/);
});

test('mod hub controller routes runtime action banners through i18n helpers', () => {
  assert.match(modHubControllerSource, /function tModHub/);
  assert.match(modHubControllerSource, /ModHub\.runtimeActionFailed/);
  assert.match(modHubControllerSource, /ModHub\.installRequiresConsent/);
  assert.match(modHubControllerSource, /ModHub\.installFromCatalogSuccess/);
  assert.match(modHubControllerSource, /ModHub\.updateSuccess/);
  assert.match(modHubControllerSource, /ModHub\.enableSuccess/);
  assert.match(modHubControllerSource, /ModHub\.disableSuccess/);
  assert.match(modHubControllerSource, /ModHub\.uninstallSuccess/);
  assert.doesNotMatch(modHubControllerSource, /操作失败|已安装，但需要重新确认后才会启用|已从 catalog 安装|已更新到|已启用|已禁用|已卸载/);
});

test('runtime config connector discovery validates node capabilities without as any', () => {
  assert.match(connectorDiscoverySource, /type RuntimeNodeCapability = 'chat' \| 'image' \| 'video' \| 'tts' \| 'stt' \| 'embedding'/);
  assert.match(connectorDiscoverySource, /function normalizeRuntimeNodeCapability/);
  assert.doesNotMatch(connectorDiscoverySource, /capability: \(\(\(n\.capabilities \|\| \[\]\)\[0\] \|\| 'chat'\) as any/);
});

test('create post modal keeps popular tags at module scope', () => {
  assert.match(createPostModalSource, /const POPULAR_TAGS = \[/);
  assert.doesNotMatch(createPostModalSource, /export function CreatePostModal[\s\S]*const POPULAR_TAGS = \[/);
});
