import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import { OvertoneLogin } from './overtone-login.js';
import { i18n } from '@renderer/i18n/index.js';

describe('OvertoneLogin', () => {
  it('renders the shared desktop-browser auth page', () => {
    const html = renderToStaticMarkup(
      <I18nextProvider i18n={i18n}>
        <OvertoneLogin />
      </I18nextProvider>,
    );

    expect(html).toContain('data-auth-mode="desktop-browser"');
    expect(html).toContain('Sign in to Overtone');
    expect(html).toContain('Click the mark to authorize in your browser.');
  });
});
