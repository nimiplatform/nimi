import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { ZhiyuResourcePackSurface } from '../src/resource-pack/ZhiyuResourcePackSurface.tsx';

test('ResourcePackSurface keeps the Pack zone decorative and canonical controls outside it', () => {
  const html = renderToStaticMarkup(
    React.createElement(
      ZhiyuResourcePackSurface,
      {
        className: 'zhiyu-chat-canvas',
        effectiveSource: 'preview',
        scopedCssText: ':where([data-zhiyu-resource-pack-surface="true"]) [data-nimi-pack-zone="surface"] { background-color: #182032; }',
      },
      React.createElement('button', { type: 'button', 'data-canonical-submit': 'true' }, 'Send'),
    ),
  );

  assert.match(html, /data-zhiyu-resource-pack-surface="true"/u);
  assert.match(html, /data-zhiyu-resource-pack-effective-source="preview"/u);
  assert.match(html, /data-nimi-pack-zone="surface"/u);
  assert.match(html, /data-zhiyu-resource-pack-guard="decorative-only"/u);
  assert.ok(html.indexOf('data-nimi-pack-zone="surface"') < html.indexOf('data-canonical-submit="true"'));
  assert.doesNotMatch(html, /data-nimi-pack-zone="surface"[^>]*>[^<]*<button/u);
});
