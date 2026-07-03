import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// kit/ui classic-runtime components resolve `React` from the module scope the
// bundler injects; the bare tsx test runner has no injection, so expose it.
(globalThis as Record<string, unknown>).React = React;
import type { NimiRuntimeAgentCanonicalMemoryInspect } from '@nimiplatform/sdk/runtime';
import { ChatAgentCognitionPanel } from '../src/shell/renderer/features/chat/chat-agent-cognition-panel.js';

function memoryFixture(overrides: Partial<NimiRuntimeAgentCanonicalMemoryInspect> = {}): NimiRuntimeAgentCanonicalMemoryInspect {
  return {
    memoryId: 'memory-1',
    canonicalClass: 'episodic',
    kind: 'observation',
    summary: 'User prefers dark roast coffee in the morning.',
    updatedAt: '2026-06-12T08:00:00Z',
    sourceEventId: 'event-1',
    policyReason: 'canonical_owner_policy',
    recallScore: 0.92,
    ...overrides,
  } as NimiRuntimeAgentCanonicalMemoryInspect;
}

function renderPanel(element: React.ReactElement): string {
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    if (String(args[0] || '').startsWith('react-i18next:: useTranslation')) {
      return;
    }
    originalWarn(...args);
  };
  try {
    return renderToStaticMarkup(element);
  } finally {
    console.warn = originalWarn;
  }
}

test('memory sovereignty card renders records and count without Desktop-private export action', () => {
  const html = renderPanel(
    <ChatAgentCognitionPanel
      targetTitle="Companion"
      recentMemories={[memoryFixture(), memoryFixture({ memoryId: 'memory-2', summary: 'Second memory record.' })]}
    />,
  );
  assert.ok(html.includes('data-testid="chat-memory-sovereignty-card"'), 'sovereignty card must render');
  assert.ok(html.includes('User prefers dark roast coffee'), 'memory summary must render');
  assert.ok(html.includes('Second memory record.'), 'second memory must render');
  assert.ok(!html.includes('data-testid="chat-memory-export-button"'), 'Desktop-private memory export action must not render');
});

test('Chat Agent cognition has no Desktop-private memory export bridge', () => {
  const root = resolve(import.meta.dirname, '..');
  const sources = [
    'src/shell/renderer/features/chat/chat-agent-shell-adapter.tsx',
    'src/shell/renderer/features/chat/chat-agent-cognition-panel.tsx',
    'src/shell/renderer/testability/e2e-ids.ts',
  ].map((file) => readFileSync(join(root, file), 'utf8')).join('\n');
  const forbidden = [
    ['export', 'Desktop', 'Agent', 'Memory'].join(''),
    ['on', 'Export', 'Memory'].join(''),
    ['chat', 'Memory', 'Export', 'Button'].join(''),
    ['chat', 'Memory', 'Export', 'Result'].join(''),
    ['runtime-agent', 'memory', 'export'].join('-'),
  ];
  assert.doesNotMatch(sources, new RegExp(forbidden.join('|')));
});

test('memory sovereignty card shows the honest empty state', () => {
  const html = renderPanel(
    <ChatAgentCognitionPanel targetTitle="Companion" recentMemories={[]} />,
  );
  assert.ok(html.includes('data-testid="chat-memory-sovereignty-card"'), 'card renders for empty memory');
  assert.ok(html.includes('No canonical memories recorded yet'), 'empty state copy must render');
  assert.ok(!html.includes('data-testid="chat-memory-export-button"'), 'no export button without handler');
});

test('memory sovereignty card stays absent without inspect data', () => {
  const html = renderPanel(
    <ChatAgentCognitionPanel targetTitle="Companion" recentMemories={null} />,
  );
  assert.ok(!html.includes('data-testid="chat-memory-sovereignty-card"'), 'card must not render without data');
});
