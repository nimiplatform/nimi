import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const repoRoot = path.resolve(root, '..', '..');

function read(relativePath) {
  return readFileSync(path.join(root, relativePath), 'utf8');
}

function readRepo(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('ZM16 product storybook is a first-class acceptance map, not an e2e script narrative', () => {
  const storybookPath = path.join(root, 'src/shell/app/zhiyu-product-storybook.ts');
  assert.equal(existsSync(storybookPath), true, 'product storybook source must exist');

  const storybook = read('src/shell/app/zhiyu-product-storybook.ts');
  for (const storyId of [
    'runtime-offline',
    'no-local-partner',
    'partner-ready',
    'model-config',
    'conversation-turn',
    'developer-backstage',
    'avatar-launch-gated',
    'speech-consume-gated',
  ]) {
    assert.match(storybook, new RegExp(`id: '${storyId}'`), `missing product story ${storyId}`);
  }
  assert.doesNotMatch(storybook, /Runtime Agent Chat|Capability Studio|Image Studio|ready checklist/i);
});

test('ZM16 product shell keeps capability probes in backstage and removes image workbench ownership', () => {
  const home = read('src/shell/app/HomeSurface.tsx');
  const backstage = read('src/shell/app/home-developer-backstage.tsx');
  const css = read('src/shell/app/home-surface.css');
  const primary = home.slice(0, home.indexOf('id="zhiyu-diagnostics-drawer"'));

  assert.match(home, /DeveloperBackstageSurface/);
  assert.match(home, /data-zhiyu-storybook-version=/);
  assert.doesNotMatch(primary, /HomeCapabilitySetupSection|ImageStudioSection|data-zhiyu-region="capability-studio"|data-zhiyu-region="image-studio"/);

  assert.match(backstage, /data-zhiyu-developer-backstage="open"/);
  assert.match(backstage, /HomeCapabilitySetupSection/);
  assert.match(backstage, /data-zhiyu-region="capability-studio"/);
  assert.match(backstage, /data-zhiyu-devmode-audio-synthesize/);
  assert.match(backstage, /audio\.synthesize/);
  assert.doesNotMatch(backstage, /ImageStudioSection|data-zhiyu-region="image-studio"|data-zhiyu-image-generate-run/);
  assert.doesNotMatch(backstage, /apps\/tester|apps\/desktop|@renderer\/|runtime\/internal/);

  assert.match(css, /\.zhiyu-home__developer-backstage[\s\S]*\.zhiyu-home__capability-studio/s);
  assert.doesNotMatch(css, /zhiyu-home__image-studio/);
});

test('ZM16 AI config presents image.generate as conversation artifact support, not image creation', () => {
  const settings = read('src/shell/ai-config/zhiyu-ai-config-settings.tsx');
  const liveRuntimeAcceptance = read('test/electron-live-runtime-acceptance.mjs');

  assert.match(settings, /对话图像产物/);
  assert.doesNotMatch(settings, /图片创作|图像创作|image studio|prompt tool/i);
  assert.doesNotMatch(liveRuntimeAcceptance, /localStorage|agent-home-ai|ai-config:index|clearZhiyuAIConfigStorage/);
  assert.match(liveRuntimeAcceptance, /resetLiveRuntimeEvidenceRoot/);
  assert.match(liveRuntimeAcceptance, /live-runtime-\.\*\\\.\(\?:png\|json\)/);
});

test('ZM16 TTS consume uses Kit generation owner surface, not tester-private invokers', () => {
  const kitRuntime = readRepo('kit/features/generation/src/runtime.ts');
  const kitSpeech = readRepo('kit/features/generation/src/runtime-speech-synthesize.ts');
  const zhiyuConsume = read('src/shell/capability-studio/zhiyu-ai-consume.ts');
  const routeProjection = read('src/shell/agent/route-projection.ts');

  assert.match(kitRuntime, /runtime-speech-synthesize/);
  assert.match(kitSpeech, /runRuntimeSpeechSynthesize/);
  assert.match(kitSpeech, /runNimiRuntimeSpeechSynthesis/);
  assert.doesNotMatch(kitSpeech, /apps\/tester|tester-runtime/);

  assert.match(zhiyuConsume, /runRuntimeSpeechSynthesize/);
  assert.match(zhiyuConsume, /audio\.synthesize/);
  assert.doesNotMatch(zhiyuConsume, /apps\/tester|tester-runtime/);
  assert.match(routeProjection, /audio\.synthesize/);
});

test('ZM16 avatar launch migration is owner-safe and fail-closed without a public handoff bridge', () => {
  const avatarLaunch = read('src/shell/avatar/avatar-launch.ts');
  const home = read('src/shell/app/HomeSurface.tsx');
  const chrome = read('src/shell/app/home-desktop-chat-shell-chrome.tsx');
  const app = read('src/shell/app/App.tsx');

  assert.match(avatarLaunch, /@nimiplatform\/kit\/features\/avatar\/headless/);
  assert.match(avatarLaunch, /arbitrateAvatarLaunch/);
  assert.match(avatarLaunch, /zhiyu-avatar-public-handoff-not-admitted/);
  assert.doesNotMatch(avatarLaunch, /apps\/desktop|@renderer\/|desktop_avatar_launch_handoff|runtime\/internal/);

  assert.match(home, /avatarLaunchAction=/);
  assert.match(chrome, /data-zhiyu-avatar-launch-entry/);
  assert.match(app, /projectZhiyuAvatarLaunchAction/);
});
