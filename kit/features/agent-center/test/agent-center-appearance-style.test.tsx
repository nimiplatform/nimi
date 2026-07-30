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
        renderImageRef: '/__nimi/avatar-preview/committed.png', renderVisiblePixels: 12,
      },
    });
    const markup = renderToStaticMarkup(<AgentCenter activeSection="appearance" session={session} />);
    expect(markup).toContain('data-agent-center-appearance-surface="committed-effect"');
    expect(markup).toContain('data-agent-center-appearance-live-view="ready"');
    expect(markup).toContain('avatar:committed');
  });

  it('fails closed for an unknown committed backend', async () => {
    const session = await sessionFor({
      appearance: {
        status: 'invalid', presentationRevision: 'p3', backendKind: 'future-backend',
        avatarAssetRef: 'avatar:opaque', avatarAssetValid: true,
        renderState: 'unavailable', renderFailureReason: 'unsupported committed backend',
      },
    });
    const markup = renderToStaticMarkup(<AgentCenter activeSection="appearance" session={session} />);
    expect(markup).toContain('data-agent-center-appearance-live-view="unavailable"');
    expect(markup).toContain('unsupported committed backend');
    expect(markup).toMatch(/disabled=""/u);
  });
});
