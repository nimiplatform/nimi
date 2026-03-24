import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Button, IconButton } from '../src/shell/renderer/components/action.js';
import { SPACING_TOKEN_VALUE, STATE_TONE_CLASS, STROKE_TOKEN_VALUE, TYPOGRAPHY_TOKEN_CLASS } from '../src/shell/renderer/components/design-tokens.js';
import { TooltipBubble } from '../src/shell/renderer/components/overlay.js';
import { Surface } from '../src/shell/renderer/components/surface.js';

test('surface applies semantic tone and elevation classes', () => {
  const markup = renderToStaticMarkup(
    <Surface tone="panel" elevation="raised" data-testid="surface-check">
      content
    </Surface>,
  );

  assert.match(markup, /nimi-surface/u);
  assert.match(markup, /nimi-surface--panel/u);
  assert.match(markup, /nimi-surface--elevation-raised/u);
  assert.match(markup, /data-testid="surface-check"/u);
});

test('button and icon button expose shared action classes', () => {
  const buttonMarkup = renderToStaticMarkup(
    <Button tone="primary">Primary</Button>,
  );
  const iconButtonMarkup = renderToStaticMarkup(
    <IconButton tone="ghost" icon={<span>x</span>} aria-label="icon action" />,
  );

  assert.match(buttonMarkup, /nimi-action--primary/u);
  assert.match(iconButtonMarkup, /nimi-action--icon/u);
  assert.match(iconButtonMarkup, /aria-label="icon action"/u);
});

test('tooltip bubble exposes shared overlay classes and coordinates', () => {
  const markup = renderToStaticMarkup(
    <TooltipBubble visible coords={{ left: 12, top: 20 }} placement="bottom">
      tip
    </TooltipBubble>,
  );

  assert.match(markup, /nimi-tooltip-layer/u);
  assert.match(markup, /nimi-tooltip-bubble/u);
  assert.match(markup, /left:12px/u);
  assert.match(markup, /top:20px/u);
});

test('design tokens export semantic typography, spacing, stroke, and state groups', () => {
  assert.equal(TYPOGRAPHY_TOKEN_CLASS.pageTitle, 'nimi-type--page-title');
  assert.equal(SPACING_TOKEN_VALUE.section, 'var(--nimi-space-section)');
  assert.equal(STROKE_TOKEN_VALUE.strong, 'var(--nimi-border-strong)');
  assert.equal(STATE_TONE_CLASS.selected, 'nimi-state--selected');
});
