import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import test from 'node:test';

import { ExploreSearchField } from '../src/shell/renderer/features/explore/explore-section-nav';
import { initI18n } from '../src/shell/renderer/i18n';

test('explore titlebar search renders its visible prompt as an accessible name', async () => {
  await initI18n();
  const markup = renderToStaticMarkup(
    React.createElement(ExploreSearchField, {
      value: '',
      onChange: () => {},
      placeholder: 'Find worlds',
    }),
  );
  assert.match(markup, /aria-label="Find worlds"/);
  assert.match(markup, /placeholder="Find worlds"/);
});
