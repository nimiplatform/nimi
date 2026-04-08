import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const desktopDir = path.resolve(import.meta.dirname, '..');
const rendererFeaturesDir = path.join(desktopDir, 'src/shell/renderer/features');

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(desktopDir, relativePath), 'utf8');
}

function listSourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const nextPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return listSourceFiles(nextPath);
    }
    if (!/\.(ts|tsx)$/.test(entry.name)) {
      return [];
    }
    return [nextPath];
  });
}

function relativeDesktopPath(filePath: string): string {
  return path.relative(desktopDir, filePath).replaceAll(path.sep, '/');
}

function findFilesContaining(pattern: RegExp, rootDir: string): string[] {
  return listSourceFiles(rootDir)
    .filter((filePath) => pattern.test(fs.readFileSync(filePath, 'utf8')))
    .map(relativeDesktopPath)
    .sort();
}

test('desktop non-text execution audit: renderer media execution surface is limited to agent chat image generation', () => {
  const mediaExecutionCallsites = findFilesContaining(
    /\bmedia\.(image|video|tts|stt)\.(generate|stream|synthesize|transcribe)\s*\(|\bmedia\.jobs\.submit\s*\(/,
    rendererFeaturesDir,
  );
  assert.deepEqual(mediaExecutionCallsites, [
    'src/shell/renderer/features/chat/chat-agent-runtime.ts',
  ]);
});

test('desktop non-text execution audit: chat execution snapshots use target-scoped scheduling for every executed capability', () => {
  const aiAdapterSource = readSource('src/shell/renderer/features/chat/chat-ai-shell-runtime-adapter.ts');
  const agentHostActionsSource = readSource('src/shell/renderer/features/chat/chat-agent-shell-host-actions.ts');

  assert.match(aiAdapterSource, /resolveAIConfigSchedulingTargetForCapability\(input\.aiConfig, 'text\.generate'\)/);
  assert.match(agentHostActionsSource, /resolveAIConfigSchedulingTargetForCapability\(input\.aiConfig, 'text\.generate'\)/);
  assert.match(agentHostActionsSource, /resolveAIConfigSchedulingTargetForCapability\(input\.aiConfig, 'image\.generate'\)/);
  assert.match(aiAdapterSource, /peekDesktopAISchedulingForEvidence\(\{\s*scopeRef: input\.aiConfig\.scopeRef,\s*target:/s);
  assert.match(agentHostActionsSource, /peekDesktopAISchedulingForEvidence\(\{\s*scopeRef: input\.aiConfig\.scopeRef,\s*target:\s*resolveAIConfigSchedulingTargetForCapability\(input\.aiConfig, 'text\.generate'\)/s);
  assert.match(agentHostActionsSource, /peekDesktopAISchedulingForEvidence\(\{\s*scopeRef: input\.aiConfig\.scopeRef,\s*target:\s*resolveAIConfigSchedulingTargetForCapability\(input\.aiConfig, 'image\.generate'\)/s);
});

test('desktop non-text execution audit: human voice inspect is playback-only, not speech synthesis execution', () => {
  const humanChatSource = readSource('src/shell/renderer/features/chat/chat-human-canonical-components.tsx');

  assert.match(humanChatSource, /new Audio\(voiceUrl\)/);
  assert.doesNotMatch(humanChatSource, /media\.tts|NimiSpeechEngine|openSpeechStream|openStream\(/);
});
