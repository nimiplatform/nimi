import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AgentCenter } from '../src/components/AgentCenter.js';
import { sessionFor } from './session-fixture.js';

describe('AgentCenter committed appearance surface', () => {
  it('renders the current committed effect from the session', async () => {
    const session = await sessionFor({
      appearance: {
        status: 'ready', presentationRevision: 'p2', backendKind: 'live2d',
        avatarAssetRef: 'avatar:committed', avatarAssetValid: true,
        renderState: 'ready', renderTier: 'avatar_preview_service',
        renderImageRef: '/__nimi/avatar-preview/committed.png',
      },
    });
    const markup = renderToStaticMarkup(<AgentCenter activeSection="appearance" session={session} />);
    expect(markup).toContain('data-agent-center-appearance-surface="committed-effect"');
    expect(markup).toContain('data-agent-center-appearance-live-view="ready"');
    expect(markup).toContain('avatar:committed');
  });

  it('does not fabricate a preview for a canonical backend without an embedded renderer', async () => {
    const session = await sessionFor({
      appearance: {
        status: 'ready', presentationRevision: 'p3', backendKind: 'video',
        avatarAssetRef: 'avatar:opaque', avatarAssetValid: true,
      },
    });
    const markup = renderToStaticMarkup(<AgentCenter activeSection="appearance" session={session} />);
    expect(markup).toContain('data-agent-center-appearance-live-view="empty"');
    expect(markup).toContain('No embedded preview is running.');
    expect(markup).toMatch(/disabled=""/u);
  });

  it('keeps the previous committed appearance recoverable when the current renderer is unavailable', async () => {
    const appearance = {
      status: 'invalid' as const,
      presentationRevision: 'p4',
      backendKind: 'live2d' as const,
      avatarAssetRef: 'avatar:current',
      avatarAssetValid: true,
      renderState: 'unavailable' as const,
      renderFailureReason: 'committed material unavailable',
      previousSelection: {
        backendKind: 'vrm' as const,
        avatarAssetReference: 'avatar:previous',
      },
    };
    const session = await sessionFor({ appearance });
    const markup = renderToStaticMarkup(<AgentCenter activeSection="appearance" session={session} />);
    expect(markup).toContain('Restore previous appearance');
  });

  it('renders the Runtime-bound default voice and avatar autoplay state', async () => {
    const session = await sessionFor({
      appearance: {
        status: 'not_configured',
        presentationRevision: 'p4',
        defaultVoiceReference: 'voice_asset_id:voice-song-lian',
        avatarAutoplay: true,
      },
    });
    const markup = renderToStaticMarkup(<AgentCenter activeSection="appearance" session={session} />);
    expect(markup).toContain('data-agent-center-default-voice="bound"');
    expect(markup).toContain('data-agent-center-default-voice-reference="voice_asset_id:voice-song-lian"');
    expect(markup).toContain('data-agent-center-avatar-autoplay="enabled"');
    expect(markup).toContain('role="switch"');
    expect(markup).toContain('aria-checked="true"');
  });
});
