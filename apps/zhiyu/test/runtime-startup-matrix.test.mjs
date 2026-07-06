import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');

test('Zhiyu startup projects the runtime execution config isolated from core Runtime bootstrap probes', () => {
  const source = readFileSync(path.join(root, 'src/shell/app/App.tsx'), 'utf8');

  assert.doesNotMatch(
    source,
    /const \[conversation, memory, route, companion, avatar\] = await Promise\.all/s,
    'Execution config projection must not share the core startup Promise.all with conversation, memory, companion, and avatar probes.',
  );
  assert.match(
    source,
    /fetchZhiyuAgentExecutionRouteEvidence\(subjectUserId\)/,
    'Startup route evidence must be fetched from the runtime execution config + readiness projection.',
  );
  assert.match(
    source,
    /subscribeZhiyuAgentExecutionReadiness\(\{ subjectUserId \}\)/,
    'Startup must keep a runtime execution readiness subscription for live updates.',
  );
  assert.match(
    source,
    /\}, \[applyExecutionRoute, evidence\.auth\.ready, evidence\.auth\.accountId\]\);/,
    'Execution config projection should be isolated in an effect keyed only by the authenticated subject.',
  );
  assert.match(
    source,
    /const refreshedRoute = await fetchZhiyuAgentExecutionRouteEvidence\(executionSubjectRef\.current\);/,
    'Submit refresh must re-read the runtime execution config + readiness, not probe or warm any route.',
  );

  // The AIConfig route projection machinery is retired: no probe, no warm,
  // no route-key merge phasing (K-AGCORE-144~150, Z-AUTH-006).
  assert.doesNotMatch(source, /probeZhiyuAgentRouteReadiness/);
  assert.doesNotMatch(source, /warmZhiyuAgentArtifactRouteBindings/);
  assert.doesNotMatch(source, /fullRouteConfigKeyRef|aiConfigRouteKeyRef/);
  assert.doesNotMatch(source, /mergeTextOnlyRouteWithCurrentArtifactBindings|zhiyuAIConfigRouteKey/);
  assert.doesNotMatch(source, /refreshZhiyuAIConfig/);
});
