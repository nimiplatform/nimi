import assert from 'node:assert/strict';
import test from 'node:test';
import { landingLinkDefaults, resolveLandingLinks } from '../src/config/landing-links.js';

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
