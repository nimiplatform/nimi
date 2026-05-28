import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

const repoRoot = resolve(import.meta.dirname, '../../..');

function readWorkspaceFile(path: string): string {
  return readFileSync(resolve(repoRoot, path), 'utf8');
}

test('Agent Chat spec limits local persistence to draft and projection-cache remediation', () => {
  const spec = readWorkspaceFile('.nimi/spec/desktop/kernel/agent-chat-projection-contract.md');

  assert.match(spec, /D-LLM-025a/);
  assert.match(spec, /limited to user drafts, renderer UI state, and a disposable projection cache/);
  assert.match(spec, /must not become canonical Agent Chat transcript/);
  assert.match(spec, /Runtime-owned session snapshots and `runtime\.agent\.turn\.\*`/);
  assert.match(spec, /Desktop `chat_agent_\*` store exists before cutover/);
});

test('Agent Chat store deletion is gated on Runtime and SDK replacement coverage', () => {
  const desktopSpec = readWorkspaceFile('.nimi/spec/desktop/kernel/agent-chat-projection-contract.md');
  const runtimeSpec = readWorkspaceFile('.nimi/spec/runtime/kernel/runtime-agent-service-contract.md');

  assert.match(desktopSpec, /D-LLM-107/);
  assert.match(desktopSpec, /must not hard-delete the `chat_agent_\*` projection-cache store/);
  assert.match(desktopSpec, /conversation summaries/);
  assert.match(desktopSpec, /GetPublicChatSessionSnapshot/);
  assert.match(desktopSpec, /app-local-drafts/);
  assert.match(desktopSpec, /in-memory optimistic projection only/);

  assert.match(runtimeSpec, /K-AGCORE-006a/);
  assert.match(runtimeSpec, /conversation summary listing scoped to the authenticated calling app/);
  assert.match(runtimeSpec, /close \/ delete \/ clear policy/);
  assert.match(runtimeSpec, /draft-only persistence/);
  assert.match(runtimeSpec, /do not admit Desktop-local transcript/);
});

test('Desktop command classification treats chat_agent store commands as migration-scoped', () => {
  const table = readWorkspaceFile('.nimi/spec/desktop/kernel/tables/command-execution-classification.yaml');

  assert.doesNotMatch(table, /memory_embedding_runtime_(?:inspect|request_bind|request_cutover)/);
  assert.match(table, /family: chat_ai_local_store[\s\S]*?regex: "\^chat_ai_\.\*\$"[\s\S]*?remediation_required: false/);
  assert.match(table, /family: chat_agent_projection_cache_migration[\s\S]*?regex: "\^chat_agent_\.\*\$"/);
  assert.match(table, /owner_domain: desktop-agent-chat-projection-cache-migration/);
  assert.match(table, /family: chat_agent_projection_cache_migration[\s\S]*?remediation_required: true/);
});
