import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppPreviewLocaleProvider } from '../../src/landing/i18n/app-preview-locale.js';
import { appPreviewMessagesZh } from '../../src/landing/content/app-preview-messages.zh.js';

/** Tests exercise the same explicit Chinese locale boundary as the public page. */
export function renderAppPreview(children: ReactNode): string {
  return renderToStaticMarkup(
    createElement(AppPreviewLocaleProvider, {
      locale: 'zh',
      messages: appPreviewMessagesZh,
      children,
    }),
  );
}
