import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
  const provisionCourier = read('apps/desktop/src/shell/renderer/infra/local-agent-courier/provision-courier.ts');
  const terminationCourier = read('apps/desktop/src/shell/renderer/infra/local-agent-courier/termination-courier.ts');
  const sdkLocalAgentIntents = read('sdk/src/realm/extensions/local-agent-intents.ts');
  const streamConsumer = read('apps/desktop/src/shell/renderer/features/chat/chat-agent-runtime-agent-stream-consumer.ts');
  const inspectContent = read('apps/desktop/src/shell/renderer/features/chat/chat-runtime-inspect-content.tsx');
  const runtimeStreamUi = read('apps/desktop/src/shell/renderer/features/chat/chat-shared-runtime-stream-ui.tsx');

  assert.match(inspectAdapter, /createHostRuntimeAgentInspectSurface/);
  assert.match(memoryAdapter, /createHostRuntimeAgentMemorySurface/);
  assert.match(presentationAdapter, /createHostRuntimeAgentPresentationProfileSurface/);
  assert.match(provisionCourier, /createHostRuntimeAgentLifecycleSurface/);
  assert.match(terminationCourier, /createHostRuntimeAgentLifecycleSurface/);
  assert.match(provisionCourier, /listRealmLocalAgentProvisionIntents/);
  assert.match(provisionCourier, /ackRealmLocalAgentProvisionIntent/);
  assert.match(terminationCourier, /listRealmLocalAgentTerminationIntents/);
  assert.match(terminationCourier, /ackRealmLocalAgentTerminationIntent/);
  assert.match(sdkLocalAgentIntents, /realm\.services\.MeService\.listMyLocalAgentProvisionIntents/);
  assert.match(sdkLocalAgentIntents, /realm\.services\.MeService\.ackMyLocalAgentProvisionIntent/);
  assert.match(sdkLocalAgentIntents, /realm\.services\.MeService\.listMyLocalAgentTerminationIntents/);
  assert.match(sdkLocalAgentIntents, /realm\.services\.MeService\.ackMyLocalAgentTerminationIntent/);
  assert.doesNotMatch(provisionCourier, /realm\.services\.MeService\.(listMyLocalAgentProvisionIntents|ackMyLocalAgentProvisionIntent)/);
  assert.doesNotMatch(terminationCourier, /realm\.services\.MeService\.(listMyLocalAgentTerminationIntents|ackMyLocalAgentTerminationIntent)/);
  assert.match(inspectContent, /CanonicalRuntimeInspectSidebar/);
  assert.match(inspectContent, /@nimiplatform\/kit\/features\/chat\/components\/canonical-runtime-inspect-sidebar/);
  assert.match(runtimeStreamUi, /@nimiplatform\/kit\/features\/avatar\/runtime/);

  [
    inspectAdapter,
    memoryAdapter,
    presentationAdapter,
    provisionCourier,
    terminationCourier,
  ].forEach((source) => {
    assert.match(source, /from '@nimiplatform\/sdk\/runtime'/);
    assert.doesNotMatch(source, /RuntimeMethodIds\.agent/);
    assert.doesNotMatch(source, /\/nimi\.runtime\.v1\.RuntimeAgentService/);
  });

  assert.match(streamConsumer, /from '@nimiplatform\/sdk\/runtime'/);
  [
    'recoverRuntimeAgentTerminalSnapshot',
    'summarizeRuntimeAgentProjectionEvent',
    'summarizeRuntimeAgentTimeline',
    'matchesRuntimeAgentProjectionScope',
  ].forEach((name) => {
    assert.match(streamConsumer, new RegExp(`\\b${name}\\b`));
    assert.doesNotMatch(streamConsumer, new RegExp(`function ${name}\\b`));
  });

  [
    inspectAdapter,
    memoryAdapter,
    presentationAdapter,
  ].forEach((source) => {
    assert.doesNotMatch(source, /projectRuntimeAgentInspectSnapshot/);
    assert.doesNotMatch(source, /projectRuntimeAgentInspectEventSummary/);
    assert.doesNotMatch(source, /buildRuntimeAgentSnapshotRecoveryEvents/);
    assert.doesNotMatch(source, /buildSetRuntimeAgentPresentationProfileRequest/);
    assert.doesNotMatch(source, /projectRuntimeAgentCanonicalMemoryBankStatus/);
  });
});
