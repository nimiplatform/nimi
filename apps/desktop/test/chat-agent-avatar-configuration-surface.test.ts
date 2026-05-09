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
  assert.doesNotMatch(mutationSource, /selected_package/u);
  assert.doesNotMatch(mutationSource, /last_validated_at/u);
  assert.doesNotMatch(presentationSource, /importAgentCenterAvatarPackage/u);
  assert.doesNotMatch(presentationSource, /validateAgentCenterAvatarPackage/u);
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

test('Agent Chat composer Avatar launch fails closed without package and backend evidence', () => {
  const presentationSource = readFileSync(
    join(repoRoot, 'src/shell/renderer/features/chat/chat-agent-shell-presentation.tsx'),
    'utf8',
  );
  const actionState = presentationSource.match(/const avatarComposerActionState = avatarActionPending[\s\S]*?: 'ready_stopped';/u);
  assert.ok(actionState, 'avatarComposerActionState must stay visible to the guard');
  assert.match(actionState[0], /!avatarConfigured/u);
  assert.match(actionState[0], /'not_configured'/u);
  assert.match(actionState[0], /!avatarPackageValid/u);
  assert.match(actionState[0], /'package_invalid'/u);

  const invalidEvidenceGuard = presentationSource.match(/if \(!avatarRunning && !avatarPackageValid\) \{[\s\S]*?\n {4}\}/u);
  assert.ok(invalidEvidenceGuard, 'Avatar launch must guard resolver and backend evidence before handoff');
  assert.match(invalidEvidenceGuard[0], /input\.onOpenAgentCenter\?\.\(\)/u);
  assert.match(invalidEvidenceGuard[0], /Chat\.agentCenterAvatarStartBackendEvidenceRequired/u);
  assert.match(invalidEvidenceGuard[0], /Chat\.agentCenterAvatarStartPackageEvidenceRequired/u);

  const guardIndex = presentationSource.indexOf('if (!avatarRunning && !avatarPackageValid)');
  const launchIndex = presentationSource.indexOf('launchDesktopAvatarHandoff({');
  assert.ok(guardIndex >= 0 && launchIndex >= 0 && guardIndex < launchIndex);
});
