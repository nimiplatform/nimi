import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { AvatarStage } from '../src/components/avatar-stage.js';

describe('avatar stage product markup', () => {
  it('does not expose backend taxonomy in default product markup', () => {
    const markup = renderToStaticMarkup(
      <AvatarStage
        snapshot={{
          presentation: {
            backendKind: 'vrm',
            avatarAssetRef: 'desktop-avatar://resource-1/avatar.vrm',
          },
          interaction: {
            phase: 'idle',
            actionCue: 'Here with you',
          },
        }}
        label="Companion"
        imageUrl="https://cdn.nimi.test/avatar.png"
        fallbackLabel="C"
        size="md"
      />,
    );

    expect(markup).not.toMatch(/VRM/u);
    expect(markup).not.toMatch(/Live2D/u);
    expect(markup).toMatch(/Here with you/u);
  });

  it('keeps small fallback authorization status readable instead of squeezing the label', () => {
    const markup = renderToStaticMarkup(
      <AvatarStage
        snapshot={{
          presentation: {
            backendKind: 'sprite2d',
          },
          interaction: {
            phase: 'idle',
          },
        }}
        label="Companion"
        fallbackLabel="C"
        statusLabel="等待授权"
        size="sm"
      />,
    );

    expect(markup).toMatch(/data-avatar-stage-status-badge="true"/u);
    expect(markup).toMatch(/data-avatar-stage-status-label="true"/u);
    expect(markup).toMatch(/max-w-\[/u);
    expect(markup).toMatch(/whitespace-nowrap/u);
    expect(markup).toMatch(/truncate/u);
    expect(markup).toMatch(/等待授权/u);
  });
});
