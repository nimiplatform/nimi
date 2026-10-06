import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');
const buildDir = mkdtempSync(path.join(tmpdir(), 'nimi-lab-capability-parameters-'));

await build({
  entryPoints: [path.join(root, 'src/lab/lab-studio-composition.ts')],
  outfile: path.join(buildDir, 'lab-capability-parameters.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'es2022',
  sourcemap: false,
  logLevel: 'silent',
});

const { labStudioComposition } = await import(
  pathToFileURL(path.join(buildDir, 'lab-capability-parameters.mjs')).href
);

test.after(async () => {
  await rm(buildDir, { recursive: true, force: true });
});

test('voice creation starts on the text-description path shown by the primary composer', () => {
  assert.deepEqual(labStudioComposition.createInitialParameterState()['voice.create'], {
    creationSource: 'text-description',
  });
});

test('video generation does not send an audio control before the user chooses one', () => {
  assert.deepEqual(labStudioComposition.createInitialParameterState()['video.generate'], {
    mode: 't2v',
  });
});

test('stored canonical audio restores the recorded source without retaining a recovery action', () => {
  const registration = labStudioComposition.getCapability('audio.separate');
  const saved = { sourceRelativePath:'imports/original-A.wav', sourceMimeType:'audio/wav', startSeconds:2, endSeconds:9, includeInstrumentParts:false, recoverySubmissionId:'completed-recovery' };
  const source = { relativePath:'saved/canonical-A.wav', mediaType:'audio/wav', displayName:'A.wav' };
  const restored = registration.parameters.restoreRecordedParameters(saved, { ok:true,kind:'artifacts',audioSeparation:{sourceAudio:source} });
  assert.equal(restored.sourceRelativePath,source.relativePath);
  assert.equal(restored.startSeconds,2);
  assert.equal(restored.endSeconds,9);
  assert.equal(restored.includeInstrumentParts,false);
  assert.equal(restored.recoverySubmissionId,undefined);
  assert.equal(registration.parameters.restoreRecordedParameters({startSeconds:2,endSeconds:9}),null);
  assert.equal(registration.parameters.restoreRecordedParameters({...saved,startSeconds:null}),null);
});
