import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildAppDetailUrl,
  landingLinkDefaults,
  resolveLandingLinks,
  resolveLocalizedLinks,
  withLocaleQuery,
} from '../src/landing/config/landing-links.js';

test('landing links use defaults when env is empty', () => {
  const links = resolveLandingLinks({});
  assert.deepEqual(links, landingLinkDefaults);
});

test('landing links reject invalid URL protocols', () => {
  const links = resolveLandingLinks({
    VITE_LANDING_APP_URL: 'javascript:alert(1)',
    VITE_LANDING_DOCS_URL: 'notaurl',
    VITE_LANDING_GITHUB_URL: 'https://github.com/nimiplatform/nimi?ref=landing',
    VITE_LANDING_PROTOCOL_URL: 'ftp://example.com/spec',
  });

  assert.equal(links.appUrl, landingLinkDefaults.appUrl);
  assert.equal(links.docsUrl, landingLinkDefaults.docsUrl);
  assert.equal(links.githubUrl, 'https://github.com/nimiplatform/nimi?ref=landing');
  assert.equal(links.protocolUrl, landingLinkDefaults.protocolUrl);
});

test('landing links accept normal same-origin paths and reject retired hash-shell paths', () => {
  const links = resolveLandingLinks({
    VITE_LANDING_APP_URL: '/#/login',
    VITE_LANDING_WEB_APP_URL: '/apps?from=landing',
  });

  assert.equal(links.appUrl, landingLinkDefaults.appUrl);
  assert.equal(links.webAppUrl, '/apps?from=landing');
});

test('landing links include desktopDownloadUrl default', () => {
  const links = resolveLandingLinks({});
  assert.equal(links.appUrl, 'https://docs.nimi.ai/start/');
  assert.equal(links.webAppUrl, '/home');
  assert.equal(links.downloadUrl, '/download');
  assert.equal(links.desktopDownloadUrl, 'https://docs.nimi.ai/desktop/');
});

test('withLocaleQuery keeps other parameters and hash on internal links', () => {
  assert.equal(withLocaleQuery('/apps', 'zh'), '/apps?lang=zh');
  assert.equal(withLocaleQuery('/apps#create-your-own', 'zh'), '/apps?lang=zh#create-your-own');
  assert.equal(withLocaleQuery('/home?from=landing', 'en'), '/home?from=landing&lang=en');
});

test('buildAppDetailUrl keeps the locale query ahead of the app id', () => {
  assert.equal(buildAppDetailUrl('/apps?lang=zh', 'nimi.parentos'), '/apps/nimi.parentos?lang=zh');
  assert.equal(buildAppDetailUrl('/apps', 'nimi.parentos'), '/apps/nimi.parentos');
});

test('resolveLocalizedLinks carries the active locale into site entries', () => {
  const localized = resolveLocalizedLinks(landingLinkDefaults, 'zh');
  assert.equal(localized.downloadUrl, '/download?lang=zh');
  assert.equal(localized.appsUrl, '/apps?lang=zh');
  assert.equal(localized.worldsUrl, '/home?lang=zh');
  assert.equal(localized.createAppUrl, '/apps?lang=zh#create-your-own');
  assert.equal(localized.createGuideUrl, 'https://docs.nimi.ai/zh/start/create-an-app');
  assert.equal(localized.appUrl, 'https://docs.nimi.ai/zh/start/');

  const en = resolveLocalizedLinks(landingLinkDefaults, 'en');
  assert.equal(en.downloadUrl, '/download?lang=en');
  assert.equal(en.createGuideUrl, 'https://docs.nimi.ai/start/create-an-app');
});
