import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { StaticPage } from '../src/pages/static-page.js';

function renderRoute(path: string, routePath: string, element: ReactElement): string {
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      { initialEntries: [path] },
      createElement(
        Routes,
        {},
        createElement(Route, { path: routePath, element }),
      ),
    ),
  );
}

test('apps page lists admitted apps as informational entries without install actions', () => {
  const html = renderRoute('/apps', '/apps', createElement(StaticPage, { kind: 'apps' }));
  assert.match(html, /ParentOS/);
  assert.match(html, /OpenMontage/);
  assert.match(html, /macOS arm64/);
  assert.match(html, /Windows x86_64/);
  assert.match(html, /href="\/apps\/nimi\.parentos\?lang=(en|zh)"/);
  assert.doesNotMatch(html, /Install now|立即安装/i);
});

test('unknown app slug renders a not-found state instead of the catalog intro', () => {
  const html = renderRoute('/apps/definitely-not-an-app', '/apps/:slug', createElement(StaticPage, { kind: 'apps' }));
  assert.match(html, /App not found|未找到这个应用/);
  assert.doesNotMatch(html, /Apps in the catalog|目录中的应用/);
});

test('app detail renders capabilities, platforms, license, and public source', () => {
  const html = renderRoute('/apps/nimi.parentos', '/apps/:slug', createElement(StaticPage, { kind: 'apps' }));
  assert.match(html, /ParentOS/);
  assert.match(html, /Transcription|语音转写/);
  assert.match(html, /MIT/);
  assert.match(html, /github\.com\/nimiplatform\/nimiapp-parentos/);
});

test('home page exposes the worlds anchor and honest availability', () => {
  const html = renderRoute('/home', '/home', createElement(StaticPage, { kind: 'home' }));
  assert.match(html, /id="worlds"/);
  assert.match(html, /no stable public installer|没有已发布的正式安装包/);
  assert.match(html, /href="\/download\?lang=(en|zh)"/);
});
