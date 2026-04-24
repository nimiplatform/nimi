import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const desktopRoot = resolve(import.meta.dirname, '..');

const avatarSmokeProfiles = [
  'chat.live2d-render-smoke.json',
  'chat.live2d-render-smoke-mark.json',
  'chat.live2d-render-smoke-sample.json',
  'chat.vrm-lifecycle-smoke.json',
];

function readProfile(profile: string) {
  return readFileSync(resolve(desktopRoot, 'e2e/fixtures/profiles', profile), 'utf8');
}

test('avatar smoke fixtures do not carry retired desktop-local agentAvatarStore bindings', () => {
  for (const profile of avatarSmokeProfiles) {
    const source = readProfile(profile);
    const parsed = JSON.parse(source) as Record<string, unknown>;

    assert.doesNotMatch(source, /agentAvatarStore/);
    assert.doesNotMatch(source, /"resources"\s*:/);
    assert.doesNotMatch(source, /"bindings"\s*:/);
    assert.equal(
      typeof (parsed.tauriFixture as Record<string, unknown> | undefined)?.agentAvatarStore,
      'undefined',
      `${profile} must not declare retired desktop-local avatar store truth`,
    );
  }
});
