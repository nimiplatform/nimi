import assert from 'node:assert/strict';
import test from 'node:test';
import { reconcileDownloadPhases } from '../src/shell/renderer/features/runtime-config/download-phase-snapshot.js';

const transfer = (id: string, state = 'running') => ({ id, state });
const environment = (id: string, state = 'installing') => ({ id, state });

test('download phase signatures ignore Runtime ordering without mutating display rows', () => {
  const transfers = [transfer('b'), transfer('a')];
  const environments = [environment('d'), environment('c')];
  const initial = reconcileDownloadPhases(undefined, { activation: 'root-a', transfers, environments });
  assert.equal(initial.invalidate, false);
  const reordered = reconcileDownloadPhases(initial.snapshot, {
    activation: 'root-a', transfers: transfers.slice().reverse(), environments: environments.slice().reverse(),
  });
  assert.equal(reordered.invalidate, false);
  assert.deepEqual(reordered.snapshot, initial.snapshot);
  assert.deepEqual(transfers.map(item => item.id), ['b', 'a']);
  assert.deepEqual(environments.map(item => item.id), ['d', 'c']);
});

test('failed sources retain confirmed phases while another source can change', () => {
  const initial = reconcileDownloadPhases(undefined, { activation: 'root-a', transfers: [transfer('a')], environments: [environment('b')] });
  const failed = reconcileDownloadPhases(initial.snapshot, { activation: 'root-a', transfers: undefined, environments: undefined });
  assert.equal(failed.invalidate, false);
  assert.deepEqual(failed.snapshot, initial.snapshot);
  const oneChanged = reconcileDownloadPhases(failed.snapshot, { activation: 'root-a', transfers: undefined, environments: [environment('b', 'ready_managed')] });
  assert.equal(oneChanged.invalidate, true);
  assert.equal(oneChanged.transfersChanged, false);
  assert.equal(oneChanged.environmentsChanged, true);
  const recovered = reconcileDownloadPhases(oneChanged.snapshot, { activation: 'root-a', transfers: [transfer('a')], environments: [environment('b', 'ready_managed')] });
  assert.equal(recovered.invalidate, false);
  const otherChanged = reconcileDownloadPhases(recovered.snapshot, { activation: 'root-a', transfers: [transfer('a', 'completed')], environments: undefined });
  assert.equal(otherChanged.invalidate, true);
  assert.equal(otherChanged.transfersChanged, true);
  assert.equal(otherChanged.environmentsChanged, false);
});

test('confirmed additions, removals, phases and empty lists remain observable', () => {
  let snapshot = reconcileDownloadPhases(undefined, { activation: 'root-a', transfers: [], environments: [] }).snapshot;
  for (const transfers of [[transfer('a')], [transfer('a'), transfer('b')], [transfer('a', 'completed'), transfer('b')], [transfer('b')], []]) {
    const next = reconcileDownloadPhases(snapshot, { activation: 'root-a', transfers, environments: [] });
    assert.equal(next.invalidate, true);
    snapshot = next.snapshot;
  }
  assert.equal(reconcileDownloadPhases(snapshot, { activation: 'root-a', transfers: [], environments: [] }).invalidate, false);
});

test('each initially unknown source invalidates once on its first successful observation', () => {
  const initial = reconcileDownloadPhases(undefined, { activation: 'root-a', transfers: undefined, environments: undefined });
  assert.equal(initial.invalidate, false);
  const failed = reconcileDownloadPhases(initial.snapshot, { activation: 'root-a', transfers: undefined, environments: undefined });
  assert.equal(failed.invalidate, false);
  const firstTransfer = reconcileDownloadPhases(failed.snapshot, { activation: 'root-a', transfers: [transfer('finished-unobserved', 'completed')], environments: undefined });
  assert.equal(firstTransfer.invalidate, true);
  assert.equal(firstTransfer.recoveredUnknown, true);
  const sameTransfer = reconcileDownloadPhases(firstTransfer.snapshot, { activation: 'root-a', transfers: [transfer('finished-unobserved', 'completed')], environments: undefined });
  assert.equal(sameTransfer.invalidate, false);
  const firstEnvironment = reconcileDownloadPhases(sameTransfer.snapshot, { activation: 'root-a', transfers: undefined, environments: [] });
  assert.equal(firstEnvironment.invalidate, true);
  assert.equal(firstEnvironment.recoveredUnknown, true);
  const bothKnown = reconcileDownloadPhases(firstEnvironment.snapshot, { activation: 'root-a', transfers: [transfer('finished-unobserved', 'completed')], environments: [] });
  assert.equal(bothKnown.invalidate, false);
});

test('activation changes invalidate once and discard each previous owner baseline', () => {
  const initial = reconcileDownloadPhases(undefined, { activation: 'root-a', transfers: [transfer('a')], environments: [environment('b')] });
  const switched = reconcileDownloadPhases(initial.snapshot, { activation: 'root-b', transfers: undefined, environments: [environment('b')] });
  assert.equal(switched.invalidate, true);
  assert.equal(switched.activationChanged, true);
  assert.equal(switched.snapshot.transfers, undefined);
  const firstTransfer = reconcileDownloadPhases(switched.snapshot, { activation: 'root-b', transfers: [transfer('different')], environments: [environment('b')] });
  assert.equal(firstTransfer.invalidate, true, 'first successful source observation closes the new owner observation gap');
  assert.equal(firstTransfer.recoveredUnknown, true);
  const changed = reconcileDownloadPhases(firstTransfer.snapshot, { activation: 'root-b', transfers: [], environments: undefined });
  assert.equal(changed.invalidate, true);
  const bothFailed = reconcileDownloadPhases(changed.snapshot, { activation: 'root-c', transfers: undefined, environments: undefined });
  assert.equal(bothFailed.invalidate, true);
  assert.equal(bothFailed.snapshot.transfers, undefined);
  assert.equal(bothFailed.snapshot.environments, undefined);
});
