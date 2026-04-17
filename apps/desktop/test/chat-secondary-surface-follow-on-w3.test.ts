import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

function readWorkspaceFile(relativePath: string): string {
  return fs.readFileSync(path.join(import.meta.dirname, '..', relativePath), 'utf8');
}

function readRepoFile(relativePathFromRepoRoot: string): string {
  return fs.readFileSync(path.join(import.meta.dirname, '..', '..', '..', relativePathFromRepoRoot), 'utf8');
}

const humanCanonicalSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-human-canonical-components.tsx');
const live2dViewportSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-agent-avatar-live2d-viewport.tsx');
const vrmViewportSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-agent-avatar-vrm-viewport.tsx');
const desktopSurfacesSpec = readRepoFile('.nimi/spec/desktop/kernel/tables/renderer-design-surfaces.yaml');
const desktopUiShellSpec = readRepoFile('.nimi/spec/desktop/kernel/ui-shell-contract.md');
const platformDesignPatternSpec = readRepoFile('.nimi/spec/platform/kernel/design-pattern-contract.md');
const platformUiAdoptionSpec = readRepoFile('.nimi/spec/platform/kernel/tables/nimi-ui-adoption.yaml');

test('W3 chat surface follow-on: canonical conversation shell is governed as a shared adapter, not a chat exception', () => {
  assert.match(humanCanonicalSource, /CanonicalTranscriptView/);
  assert.match(humanCanonicalSource, /CanonicalStagePanel/);
  assert.match(humanCanonicalSource, /return \(\s*<CanonicalTranscriptView \{\.\.\.transcriptProps\} \/>\s*\)/);
  assert.match(humanCanonicalSource, /return <CanonicalStagePanel \{\.\.\.stagePanelProps\} \/>;/);
  assert.match(desktopUiShellSpec, /## D-SHELL-031 — Chat Canonical Ownership And Avatar Viewport Exception Admission/);
  assert.match(desktopSurfacesSpec, /id: chat\.canonical\.conversation_shell_adapter[\s\S]*surface_profile: secondary[\s\S]*exception_policy: none[\s\S]*source_rule: D-SHELL-031/);
});

test('W3 chat surface follow-on: avatar viewport chrome is admitted narrowly as a controlled exception', () => {
  assert.match(live2dViewportSource, /chrome = 'default'/);
  assert.match(live2dViewportSource, /chrome === 'minimal'/);
  assert.match(vrmViewportSource, /chrome = 'default'/);
  assert.match(vrmViewportSource, /chrome === 'minimal'/);
  assert.match(desktopSurfacesSpec, /id: chat\.avatar\.live2d\.viewport_exception[\s\S]*surface_profile: exception[\s\S]*exception_policy: controlled[\s\S]*source_rule: D-SHELL-031/);
  assert.match(desktopSurfacesSpec, /id: chat\.avatar\.vrm\.viewport_exception[\s\S]*surface_profile: exception[\s\S]*exception_policy: controlled[\s\S]*source_rule: D-SHELL-031/);
  assert.match(platformDesignPatternSpec, /desktop chat avatar viewport chrome \(Live2D \/ VRM\)/);
  assert.match(platformUiAdoptionSpec, /id: desktop\.chat\.avatar\.live2d\.exception[\s\S]*exception_policy: controlled_exception/);
  assert.match(platformUiAdoptionSpec, /id: desktop\.chat\.avatar\.vrm\.exception[\s\S]*exception_policy: controlled_exception/);
});
