import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const APP_FACING_MEMORY_EXPORTS = [
  'AgentMemoryItem',
  'AgentMemoryProjection',
  'CognitionMemoryEpistemicStatus',
  'CognitionMemoryLifecycle',
  'CognitionMemoryOutcome',
  'CorrectLocalAppAgentMemoryRequest',
  'CorrectLocalAppAgentMemoryResponse',
  'DeleteAllLocalAppAgentMemoryRequest',
  'DeleteAllLocalAppAgentMemoryResponse',
  'ForgetLocalAppAgentMemoryRequest',
  'ForgetLocalAppAgentMemoryResponse',
  'InspectLocalAppAgentMemoryRequest',
  'InspectLocalAppAgentMemoryResponse',
  'SetLocalAppAgentMemoryEnabledRequest',
  'SetLocalAppAgentMemoryEnabledResponse',
] as const;

function runtimeWireTypeExports(): readonly string[] {
  const entry = fileURLToPath(new URL('./wire-types/index.ts', import.meta.url));
  const program = ts.createProgram([entry], {
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noEmit: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ES2022,
  });
  const source = program.getSourceFile(entry);
  assert.ok(source, 'runtime wire-types entry must be part of the TypeScript program');
  const checker = program.getTypeChecker();
  const moduleSymbol = checker.getSymbolAtLocation(source);
  assert.ok(moduleSymbol, 'runtime wire-types entry must resolve to a module symbol');
  return checker.getExportsOfModule(moduleSymbol).map((symbol) => symbol.getName()).sort();
}

test('public Runtime wire-types expose only the App-facing Cognition Memory contract', () => {
  const exports = runtimeWireTypeExports();
  const memoryExports = exports.filter((name) => (
    name.startsWith('AgentMemory')
    || name.startsWith('CognitionMemory')
    || name.includes('LocalAppAgentMemory')
    || name.startsWith('MemoryEmbedding')
    || name === 'MemoryDistanceMetric'
    || name === 'MemoryMigrationPolicy'
  ));

  assert.deepEqual(memoryExports, [...APP_FACING_MEMORY_EXPORTS].sort());
});
