import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LanguageToggle } from '../src/landing/components/language-toggle.js';

const options = {
  en: 'English',
  zh: '中文',
  switchToEn: 'Switch to English',
  switchToZh: '切换到中文',
};

test('language toggle shows the current locale with a dropdown that opens on demand', () => {
  for (const locale of ['en', 'zh'] as const) {
    const html = renderToStaticMarkup(createElement(LanguageToggle, {
      locale,
      label: 'Language',
      options,
      onChange: () => {},
    }));

    // Compact button: current locale label with a chevron dropdown affordance.
    assert.ok(html.includes('aria-haspopup="menu"'));
    assert.ok(html.includes('aria-expanded="false"'));
    assert.ok(html.includes(`>${options[locale]}<`));

    // The locale menu stays closed until the button is pressed.
    assert.ok(!html.includes('role="menu"'));
  }
});
