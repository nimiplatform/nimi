import { createPlatformClient } from '@nimiplatform/sdk';
import { loadGoldFixture, loadGoldFixtureAudioInput } from '../../../../scripts/ai-gold-path/fixtures.mjs';
import { runDesktopBridgeReplay } from '../../src/runtime/llm-adapter/execution/replay.js';

function readArg(flag: string): string {
  const index = process.argv.indexOf(flag);
  if (index < 0) {
    return '';
  }
  return String(process.argv[index + 1] || '').trim();
}

function requireGoldSubjectUserId(): string {
  const value = String(process.env.NIMI_LIVE_GOLD_SUBJECT_USER_ID || '').trim();
  if (!value) {
    throw new Error('NIMI_LIVE_GOLD_SUBJECT_USER_ID_REQUIRED');
  }
  return value;
}

async function main(): Promise<void> {
  const endpoint = readArg('--endpoint');
  const fixturePath = readArg('--fixture');
  if (!endpoint) {
    throw new Error('DESKTOP_GOLD_ENDPOINT_REQUIRED');
  }
  if (!fixturePath) {
    throw new Error('DESKTOP_GOLD_FIXTURE_REQUIRED');
  }

  const fixture = loadGoldFixture(fixturePath);
  const fixtureAudio = loadGoldFixtureAudioInput(fixture);
  const subjectUserId = requireGoldSubjectUserId();
  const { runtime } = await createPlatformClient({
    authMode: 'external-principal',
    appId: 'nimi.desktop.ai.gold',
    runtimeTransport: {
      type: 'node-grpc',
      endpoint,
    },
    runtimeDefaults: {
      callerKind: 'desktop-core',
      callerId: 'desktop-ai-gold-path',
    },
    realmBaseUrl: 'http://localhost:3002',
    subjectUserIdProvider: () => subjectUserId,
  });

  const result = await runDesktopBridgeReplay({
    runtime,
    fixture: fixtureAudio?.kind === 'bytes'
      ? {
        ...fixture,
        request: {
          ...fixture.request,
          audio_base64: fixtureAudio.base64,
          mime_type: fixtureAudio.mimeType,
        },
      }
      : fixture,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

void main().catch((error) => {
  const detail = error instanceof Error ? error.message : String(error || '');
  process.stderr.write(`${detail}\n`);
  process.exitCode = 1;
});
