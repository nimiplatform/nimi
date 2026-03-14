import assert from 'node:assert/strict';
import test from 'node:test';
import { landingLinkDefaults, resolveLandingLinks } from '../src/landing/config/landing-links.js';

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

test('landing links accept same-origin app-relative paths', () => {
  const links = resolveLandingLinks({
    VITE_LANDING_APP_URL: '/#/login',
    VITE_LANDING_WEB_APP_URL: '/#/',
  });

  assert.equal(links.appUrl, '/#/login');
  assert.equal(links.webAppUrl, '/#/');
});

test('landing links include desktopDownloadUrl and modDocsUrl defaults', () => {
  const links = resolveLandingLinks({});
  assert.equal(links.appUrl, '/#/login');
  assert.equal(links.webAppUrl, '/#/login');
  assert.ok(links.desktopDownloadUrl.startsWith('https://'));
  assert.ok(links.modDocsUrl.startsWith('https://'));
});
