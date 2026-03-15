import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  STREAM_FIRST_PACKET_TIMEOUT_MS,
  STREAM_SPEECH_TOTAL_TIMEOUT_MS,
  STREAM_TEXT_TOTAL_TIMEOUT_MS,
  STREAM_VIDEO_TOTAL_TIMEOUT_MS,
} from '../src/shell/renderer/features/turns/stream-controller';
import { TEXT_GENERATE_TIMEOUT_MS } from '../src/runtime/llm-adapter/execution/types';

const SPEC_TIMEOUTS_PATH = resolve(
  import.meta.dirname,
  '../../../spec/runtime/kernel/tables/ai-timeout-defaults.yaml',
);
const HOST_CAPABILITIES_PATH = resolve(
  import.meta.dirname,
  '../src/shell/renderer/infra/bootstrap/runtime-bootstrap-host-capabilities.ts',
);
const HOST_CAPABILITIES_MEDIA_PATH = resolve(
  import.meta.dirname,
  '../src/shell/renderer/infra/bootstrap/runtime-bootstrap-host-capabilities-media.ts',
);

function readSpecTimeout(operation: string): number {
  const source = readFileSync(SPEC_TIMEOUTS_PATH, 'utf8');
  const escapedOperation = operation.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = source.match(new RegExp(`operation: ${escapedOperation}[\\s\\S]*?default_ms: (\\d+)`));
  assert.ok(match, `expected timeout entry for ${operation}`);
  return Number(match[1]);
}

test('D-STRM-006: Desktop-owned timeout constants match K-DAEMON-008 defaults', () => {
  assert.equal(TEXT_GENERATE_TIMEOUT_MS, readSpecTimeout('ExecuteScenario_text_generate'));
  assert.equal(STREAM_FIRST_PACKET_TIMEOUT_MS, readSpecTimeout('StreamScenario_first_packet'));
  assert.equal(STREAM_TEXT_TOTAL_TIMEOUT_MS, readSpecTimeout('StreamScenario_total'));
  assert.equal(STREAM_SPEECH_TOTAL_TIMEOUT_MS, readSpecTimeout('StreamScenario_speech_synthesize'));
  assert.equal(STREAM_VIDEO_TOTAL_TIMEOUT_MS, readSpecTimeout('SubmitScenarioJob_video'));
});

test('D-STRM-006: Desktop media job submit path does not inject conflicting timeout overrides', () => {
  const source = [HOST_CAPABILITIES_PATH, HOST_CAPABILITIES_MEDIA_PATH]
    .map((filePath) => readFileSync(filePath, 'utf8'))
    .join('\n');
  const jobsStart = source.indexOf('jobs: {');
  const jobsEnd = source.indexOf('get: async', jobsStart);
  assert.ok(
    jobsStart >= 0 && jobsEnd > jobsStart,
    'expected jobs submit block in runtime-bootstrap-host-capabilities sources',
  );

  const jobsBlock = source.slice(jobsStart, jobsEnd);
  assert.ok(
    !jobsBlock.includes('timeoutMs:'),
    'media.jobs.submit branches should rely on runtime defaults instead of Desktop hardcoded timeoutMs overrides',
  );
});
