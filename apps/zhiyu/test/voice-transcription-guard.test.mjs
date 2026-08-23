import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');
let buildDir = null;

test.after(async () => {
  if (buildDir) await rm(buildDir, { recursive: true, force: true });
});

test('cancel while transcribing aborts the request and suppresses late turn submit', async () => {
  const output = path.join(buildDir = mkdtempSync(path.join(tmpdir(), 'nimi-zhiyu-voice-guard-')), 'guard.mjs');
  await build({
    entryPoints: [path.join(root, 'src/shell/agent-chat/voice-transcription-guard.ts')],
    outfile: output, bundle: true, platform: 'node', format: 'esm', target: 'es2022', logLevel: 'silent',
  });
  const { runZhiyuVoiceTranscriptionAttempt } = await import(pathToFileURL(output).href);
  const controller = new AbortController();
  let resolveTranscript;
  let observedSignal = null;
  let submits = 0;
  const attempt = runZhiyuVoiceTranscriptionAttempt({
    audioBytes: Uint8Array.of(1, 2, 3), mimeType: 'audio/webm', signal: controller.signal,
    isCurrent: () => true,
    transcribe: async (_bytes, _mime, signal) => {
      observedSignal = signal;
      return new Promise((resolve) => { resolveTranscript = resolve; });
    },
    submit: async () => { submits += 1; },
  });
  await Promise.resolve();
  controller.abort();
  resolveTranscript('late transcript');
  assert.equal(await attempt, 'stale');
  assert.equal(observedSignal, controller.signal);
  assert.equal(submits, 0);
});
