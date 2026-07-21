import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');

test('Zhiyu startup projects Runtime Agent AI Config isolated from core Runtime bootstrap probes', () => {
  const source = readFileSync(path.join(root, 'src/shell/app/App.tsx'), 'utf8');
  const production = readFileSync(path.join(root, 'src/production/renderer-bindings.ts'), 'utf8');

  assert.doesNotMatch(
    production,
    /const \[conversation, memory, route, companion, avatar\] = await Promise\.all/s,
    'Runtime Agent AI Config projection must not share the core startup Promise.all with conversation, memory, companion, and avatar probes.',
  );
  assert.match(
    production,
    /loadExecutionRoute:\s*fetchZhiyuAgentAIConfigRouteEvidence/,
    'Startup route evidence must be fetched from Runtime Agent AI Config + readiness projection.',
  );
  assert.match(
    production,
    /const stream = subscribeZhiyuAgentAIConfigReadiness\(\{[\s\S]*subjectUserId,[\s\S]*ownerUserId:[\s\S]*runtimeSourceRef:[\s\S]*localAgentRef:/,
    'Startup must keep a Runtime Agent AI Config readiness subscription for live updates.',
  );
  assert.match(
    source,
    /evidence\.conversation\.localAgentRef,/,
    'Runtime Agent AI Config projection must be keyed by the selected Runtime Local Agent identity.',
  );
  assert.match(
    source,
    /const \[selectedLocalAgentRefreshKey, setSelectedLocalAgentRefreshKey\] = useState\(0\);/,
    'Selecting the current Runtime LocalAgent again must have an explicit refresh key for retrying conversation bootstrap.',
  );
  assert.match(
    source,
    /\}, \[bindings, selectedLocalAgentRef, selectedLocalAgentRefreshKey\]\);/,
    'Runtime bootstrap effect must rerun when the selected Runtime LocalAgent is explicitly reselected.',
  );
  assert.match(
    source,
    /setSelectedLocalAgentRefreshKey\(\(current\) => current \+ 1\);/,
    'Runtime LocalAgent selection handler must bump the refresh key even when the selected ref is unchanged.',
  );
  assert.match(
    source,
    /const refreshedRoute = await bindings\.app\.projection\.loadExecutionRoute\(agentAIConfigRouteInputRef\.current\);/,
    'Submit refresh must re-read Runtime Agent AI Config + readiness, not probe or warm any route.',
  );

  // The pre-cutover route projection machinery is retired: no probe, no warm,
  // no route-key merge phasing (K-AGCORE-144~150, Z-AUTH-006).
  assert.doesNotMatch(source, /probeZhiyuAgentRouteReadiness/);
  assert.doesNotMatch(source, /warmZhiyuAgentArtifactRouteBindings/);
  assert.doesNotMatch(source, /fullRouteConfigKeyRef|aiConfigRouteKeyRef/);
  assert.doesNotMatch(source, /mergeTextOnlyRouteWithCurrentArtifactBindings|zhiyuAIConfigRouteKey/);
  assert.doesNotMatch(source, /refreshZhiyuAIConfig/);
  assert.doesNotMatch(source, /fetchZhiyuAgentAIConfigRouteEvidence|subscribeZhiyuAgentAIConfigReadiness/);
});
