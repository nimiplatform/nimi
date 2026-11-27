import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  NIMI_RUNTIME_AGENT_RESOLVED_STATUS_CUE_MOODS,
  connectRemoteRuntime,
  type NimiRuntimeAgentResolvedStatusCueMood,
} from '../src/sdk-contract.js';

describe('kit sdk-contract', () => {
  it('re-exports only the Runtime emotion vocabulary still required by Kit', () => {
    const mood: NimiRuntimeAgentResolvedStatusCueMood = 'neutral';
    expect(mood).toBe('neutral');
    expect(NIMI_RUNTIME_AGENT_RESOLVED_STATUS_CUE_MOODS).toContain('ext:grateful');
  });

  it('defers @nimiplatform/sdk/runtime/remote behind an async dynamic import at the single sdk-contract boundary', () => {
    expect(typeof connectRemoteRuntime).toBe('function');
    const source = readFileSync(path.resolve(import.meta.dirname, '../src/sdk-contract.ts'), 'utf8');
    expect(source).not.toMatch(/export\s*\{[^}]*\bconnectRemoteRuntime\b[^}]*\}\s*from\s*['"]@nimiplatform\/sdk\/runtime\/remote['"]/u);
    expect(source).toMatch(/await\s+import\s*\(\s*['"]@nimiplatform\/sdk\/runtime\/remote['"]\s*\)/u);
  });
});
