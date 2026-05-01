import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = join(import.meta.dirname, '..');

test('Agent Chat Settings Avatar surface exposes closed configuration controls', () => {
  const settingsSource = readFileSync(
    join(repoRoot, 'src/shell/renderer/features/chat/chat-agent-shell-presentation-settings.tsx'),
    'utf8',
  );
  const presentationSource = readFileSync(
    join(repoRoot, 'src/shell/renderer/features/chat/chat-agent-shell-presentation.tsx'),
    'utf8',
  );
  const mutationSource = readFileSync(
    join(repoRoot, 'src/shell/renderer/features/chat/chat-agent-center-avatar-config-mutation.ts'),
    'utf8',
  );

  for (const requiredControl of [
    'backend_kind',
    'avatar_instance_policy',
    'generated_motion_provider_policy',
    'launch_mode',
    'debug_profile',
    'backend_capability_profile_ref',
  ]) {
    assert.match(settingsSource, new RegExp(requiredControl, 'u'));
  }

  assert.match(presentationSource, /useAgentCenterAvatarConfigMutation/u);
  assert.match(mutationSource, /putAgentCenterLocalConfig/u);
  assert.match(mutationSource, /nextAvatarPackage\.backend_kind = nextAvatarPackage\.selected_package\.kind/u);
  assert.match(mutationSource, /nextAvatarPackage\.avatar_package_ref = nextAvatarPackage\.selected_package\.package_id/u);
});

test('Agent Chat Settings Avatar surface does not widen Avatar launch handoff', () => {
  const presentationSource = readFileSync(
    join(repoRoot, 'src/shell/renderer/features/chat/chat-agent-shell-presentation.tsx'),
    'utf8',
  );
  const launchCall = presentationSource.match(/launchDesktopAvatarHandoff\(\{[\s\S]*?\}\)/u);
  assert.ok(launchCall, 'launchDesktopAvatarHandoff call must stay visible to the guard');
  assert.match(launchCall[0], /agentId/u);
  assert.match(launchCall[0], /avatarInstanceId/u);
  assert.match(launchCall[0], /sourceSurface/u);
  assert.doesNotMatch(launchCall[0], /package|descriptor|path|profile|token|account|realm|binding|carrier/u);
});
