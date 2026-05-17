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
});
