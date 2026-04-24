import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(import.meta.dirname, relativePath), 'utf8');
}

const explorePanelSource = readSource('../src/shell/renderer/features/explore/explore-panel.tsx');
const exploreFlowSource = readSource('../src/runtime/data-sync/flows/explore-flow.ts');
const facadeActionsSource = readSource('../src/runtime/data-sync/facade-actions.ts');
const facadeSource = readSource('../src/runtime/data-sync/facade.ts');
const dataSyncContractSource = readSource('../../../.nimi/spec/desktop/kernel/data-sync-contract.md');
const dataSyncFlowsSource = readSource('../../../.nimi/spec/desktop/kernel/tables/data-sync-flows.yaml');

test('ExplorePanel consumes the declared DataSync owner instead of direct service calls', () => {
  assert.match(explorePanelSource, /dataSync\.loadExploreAgents\(\{ tag, query, limit: PAGE_SIZE \}\)/);
  assert.match(explorePanelSource, /dataSync\.loadExploreFeed\(tag \?\? null, PAGE_SIZE\)/);
  assert.match(explorePanelSource, /dataSync\.loadMoreExploreFeed\(PAGE_SIZE, cursor, tag\)/);
  assert.doesNotMatch(explorePanelSource, /SearchService/);
  assert.doesNotMatch(explorePanelSource, /ExploreService/);
  assert.doesNotMatch(explorePanelSource, /searchIndexedUsers/);
  assert.doesNotMatch(explorePanelSource, /getExploreFeed/);
  assert.doesNotMatch(explorePanelSource, /dataSync\.callApi/);
});

test('explore-flow owns Explore service invocation and argument ordering', () => {
  assert.match(exploreFlowSource, /export async function loadExploreAgents/);
  assert.match(exploreFlowSource, /SearchService\.searchIndexedUsers\(/);
  assert.match(exploreFlowSource, /ExploreService\.getExploreFeed\(/);
  assert.match(facadeActionsSource, /loadExploreAgents\(input\.callApiTask, input\.emitFacadeError, agentInput\)/);
  assert.match(facadeSource, /loadExploreAgents\(input: \{ tag\?: string \| null; query\?: string \| null; limit\?: number \} = \{\}\)/);
});

test('D-DSYNC-008 declares the Explore agent recommendation facade method', () => {
  assert.match(dataSyncContractSource, /loadExploreAgents/);
  assert.match(dataSyncContractSource, /SearchService/);
  assert.match(dataSyncFlowsSource, /flow: explore[\s\S]*loadExploreAgents[\s\S]*loadExploreFeed[\s\S]*loadMoreExploreFeed/);
});
