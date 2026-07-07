import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');

test('Zhiyu startup projects Runtime Agent AI Config isolated from core Runtime bootstrap probes', () => {
  const source = readFileSync(path.join(root, 'src/shell/app/App.tsx'), 'utf8');

  assert.doesNotMatch(
    source,
    /const \[conversation, memory, route, companion, avatar\] = await Promise\.all/s,
    'Runtime Agent AI Config projection must not share the core startup Promise.all with conversation, memory, companion, and avatar probes.',
  );
  assert.match(
    source,
    /fetchZhiyuAgentAIConfigRouteEvidence\(routeInput\)/,
    'Startup route evidence must be fetched from Runtime Agent AI Config + readiness projection.',
  );
  assert.match(
    source,
    /subscribeZhiyuAgentAIConfigReadiness\(callInput\)/,
    'Startup must keep a Runtime Agent AI Config readiness subscription for live updates.',
  );
  assert.match(
    source,
    /evidence\.conversation\.localAgentRef,/,
    'Runtime Agent AI Config projection must be keyed by the selected Runtime Local Agent identity.',
  );
  assert.match(
    source,
    /const refreshedRoute = await fetchZhiyuAgentAIConfigRouteEvidence\(agentAIConfigRouteInputRef\.current\);/,
    'Submit refresh must re-read Runtime Agent AI Config + readiness, not probe or warm any route.',
  );

  // The pre-cutover route projection machinery is retired: no probe, no warm,
  // no route-key merge phasing (K-AGCORE-144~150, Z-AUTH-006).
  assert.doesNotMatch(source, /probeZhiyuAgentRouteReadiness/);
  assert.doesNotMatch(source, /warmZhiyuAgentArtifactRouteBindings/);
  assert.doesNotMatch(source, /fullRouteConfigKeyRef|aiConfigRouteKeyRef/);
  assert.doesNotMatch(source, /mergeTextOnlyRouteWithCurrentArtifactBindings|zhiyuAIConfigRouteKey/);
  assert.doesNotMatch(source, /refreshZhiyuAIConfig/);
});
