import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { parseRuntimeLiveTestDefinitions } from './live-provider-utils.mjs';

test('runtime parser mirrors Go local voice workflow exclusion', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'nimi-live-provider-utils-'));
  const file = path.join(dir, 'live_provider_smoke_matrix_test.go');
  try {
    writeFileSync(file, `
package ai

func TestLiveSmokeProviderCapabilityMatrix(t *testing.T) {
  if record.SupportsVoiceClone && providerID != "local" {
    t.Run("voice_clone", func(t *testing.T) {})
  }
  if record.SupportsVoiceDesign && providerID != "local" {
    t.Run("voice_design", func(t *testing.T) {})
  }
}
`, 'utf8');

    const definitions = parseRuntimeLiveTestDefinitions(file);
    const local = definitions.get('local') || new Map();
    const dashscope = definitions.get('dashscope') || new Map();

    assert.equal(local.has('voice_clone'), false);
    assert.equal(local.has('voice_design'), false);
    assert.equal(dashscope.has('voice_clone'), true);
    assert.equal(dashscope.has('voice_design'), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
