import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '../../..');

function read(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('Runtime Agent domain stays on SDK and Kit shared surfaces', () => {
  const inspectAdapter = read('apps/desktop/src/shell/renderer/infra/runtime-agent-inspect.ts');
  const memoryAdapter = read('apps/desktop/src/shell/renderer/infra/runtime-agent-memory.ts');
  const presentationAdapter = read('apps/desktop/src/shell/renderer/infra/runtime-agent-presentation-profile.ts');
  const streamAdapter = read('apps/desktop/src/shell/renderer/features/chat/chat-agent-runtime-agent.ts');
  const avatarLiveInstanceBinding = read(
    'apps/desktop/src/shell/renderer/features/chat/chat-agent-avatar-live-instance-runtime-binding.ts',
  );
  const inspectContent = read('apps/desktop/src/shell/renderer/features/chat/chat-runtime-inspect-content.tsx');
  const runtimeStreamUi = [
    read('apps/desktop/src/shell/renderer/features/chat/chat-shared-runtime-stream-ui.tsx'),
    read('apps/desktop/src/shell/renderer/features/chat/chat-shared-runtime-voice-message-content.tsx'),
  ].join('\n');

  assert.match(inspectAdapter, /createNimiHostRuntimeAgentInspectSurface/);
  assert.match(memoryAdapter, /createNimiHostRuntimeAgentMemorySurface/);
  assert.match(presentationAdapter, /createNimiHostRuntimeAgentPresentationProfileSurface/);
  assert.equal(
    existsSync(path.join(repoRoot, 'apps/desktop/src/shell/renderer/infra/local-agent-courier')),
    false,
    'Realm source admission must not create or delete LocalAgent through a Desktop courier',
  );
  assert.match(inspectContent, /CanonicalRuntimeInspectSidebar/);
  assert.match(inspectContent, /@nimiplatform\/kit\/features\/chat\/components\/canonical-runtime-inspect-sidebar/);
  assert.match(runtimeStreamUi, /@nimiplatform\/kit\/features\/avatar\/runtime/);

  [
    inspectAdapter,
    memoryAdapter,
    presentationAdapter,
  ].forEach((source) => {
    assert.match(source, /from '@nimiplatform\/sdk\/runtime'/);
    assert.doesNotMatch(source, /RuntimeMethodIds\.agent/);
    assert.doesNotMatch(source, /\/nimi\.runtime\.v1\.RuntimeAgentService/);
  });

  assert.match(streamAdapter, /runNimiRuntimeAgentTurn/);
  assert.match(streamAdapter, /from '@nimiplatform\/sdk\/runtime'/);
  assert.doesNotMatch(streamAdapter, /recoverNimiRuntimeAgentTerminalSnapshot/);
  assert.doesNotMatch(streamAdapter, /summarizeNimiRuntimeAgentTimeline/);
  assert.match(avatarLiveInstanceBinding, /createNimiRuntimeAgentConsumeClient/);
  assert.match(avatarLiveInstanceBinding, /getDesktopRuntime\(\)\.agents/);
  assert.match(avatarLiveInstanceBinding, /getDesktopAppId\(\)/);
  assert.match(avatarLiveInstanceBinding, /registerAvatarLiveInstance/);
  assert.doesNotMatch(avatarLiveInstanceBinding, /getPlatformClient/);
  assert.doesNotMatch(avatarLiveInstanceBinding, /runtime\.agent\.anchors/);
  assert.doesNotMatch(avatarLiveInstanceBinding, /registerAvatarLiveInstanceBinding\(/);
  [
    'recoverNimiRuntimeAgentTerminalSnapshot',
    'summarizeNimiRuntimeAgentProjectionEvent',
    'summarizeNimiRuntimeAgentTimeline',
    'matchesNimiRuntimeAgentProjectionScope',
  ].forEach((name) => {
    assert.doesNotMatch(streamAdapter, new RegExp(`function ${name}\\b`));
  });

  [
    inspectAdapter,
    memoryAdapter,
    presentationAdapter,
  ].forEach((source) => {
    assert.doesNotMatch(source, /projectRuntimeAgentInspectSnapshot/);
    assert.doesNotMatch(source, /projectRuntimeAgentInspectEventSummary/);
    assert.doesNotMatch(source, /buildNimiRuntimeAgentSnapshotRecoveryEvents/);
    assert.doesNotMatch(source, /buildSetRuntimeAgentPresentationProfileRequest/);
    assert.doesNotMatch(source, /projectRuntimeAgentCanonicalMemoryBankStatus/);
  });
});
