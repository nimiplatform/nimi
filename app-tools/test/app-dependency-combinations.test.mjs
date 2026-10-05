import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveDependencyCombination } from '../lib/app-dependency-combinations.mjs';

const versions={sdkVersion:'^0.18.1',kitVersion:'^0.15.3',nimiShellTauriVersion:'0.7.0'};
const app=(sdk,kit)=>({dependencies:{'@nimiplatform/sdk':sdk,'@nimiplatform/kit':kit}});
test('independent Agent work and Integration pair is preserved without changing fresh scaffold defaults',()=>{
  assert.deepEqual(resolveDependencyCombination(app('^0.19.0','^0.16.0'),versions),{
    sdkVersion:'^0.19.0',kitVersion:'^0.16.0',nimiShellTauriVersion:'0.8.0',source:'existing',
  });
  assert.equal(resolveDependencyCombination({},versions).sdkVersion,'^0.18.1');
  assert.equal(resolveDependencyCombination(app('^0.18.1','^0.15.3'),versions).source,'default');
});
test('mixing one new package with the old carrier still fails before scaffold writes',()=>{
  assert.deepEqual(resolveDependencyCombination(app('^0.20.0','^0.17.0'),versions),{sdkVersion:'^0.20.0',kitVersion:'^0.17.0',nimiShellTauriVersion:'0.9.0',source:'existing'});
  assert.throws(()=>resolveDependencyCombination(app('^0.20.0','^0.16.0'),versions),/Unsupported SDK\/Kit combination/);
  assert.throws(()=>resolveDependencyCombination(app('^0.19.0','^0.15.3'),versions),/Unsupported SDK\/Kit combination/);
  assert.throws(()=>resolveDependencyCombination(app('^0.18.1','^0.16.0'),versions),/Unsupported SDK\/Kit combination/);
});
