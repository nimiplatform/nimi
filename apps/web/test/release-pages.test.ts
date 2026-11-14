import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { DownloadPageView, PUBLIC_PAGE_CONTENT } from '../src/pages/release-pages.js';

const REQUIRED_ATTRIBUTION = 'Free code signing provided by SignPath.io, certificate by SignPath Foundation.';

test('official routes and planned signing attribution remain clear in both locales', () => {
  for (const locale of ['en', 'zh'] as const) {
    const copy = PUBLIC_PAGE_CONTENT[locale];
    assert.equal(copy.download.meta.canonical, 'https://nimi.ai/download');
    assert.equal(copy.policy.meta.canonical, 'https://nimi.ai/code-signing');
    assert.equal(copy.policy.attribution, REQUIRED_ATTRIBUTION);
    assert.match(copy.policy.attributionPending, /only after|仅在/u);
    assert.match(copy.policy.team.items?.join('\n') ?? '', /@snowzane/);
    assert.ok(copy.policy.verificationChecks.every((check) => check.length > 0));
  }
});

test('the Beta identifies its actual platform assets and independent channel', () => {
  for (const locale of ['en', 'zh'] as const) {
    const { download, policy } = PUBLIC_PAGE_CONTENT[locale];
    assert.match(download.scope, /Beta v0\.2\.4/);
    const release = policy.build.paragraphs.join('\n');
    for (const owner of ['nimi', 'desktop', 'runtime']) {
      assert.ok(release.includes(`${owner}/v<version>`));
    }
    assert.match(release, /stable/i);
    const status = policy.status.paragraphs.join('\n');
    assert.match(status, /channel=beta/);
    assert.match(status, /Nimi-0\.2\.4-windows-amd64\.exe/);
    assert.match(status, /10\.0\.19041/);
    assert.match(status, /Nimi-0\.2\.4-macos-arm64\.pkg/);
    assert.match(status, /13\.0/);
    assert.match(download.requirements.linux, /No installer|暂无安装包/u);
  }
});

test('metadata verification does not imply Authenticode or broaden planned SignPath scope', () => {
  for (const locale of ['en', 'zh'] as const) {
    const page = PUBLIC_PAGE_CONTENT[locale].policy;
    const text = JSON.stringify(page);
    assert.match(text, /Ed25519/);
    assert.match(text, /P-SUPD-012/);
    assert.match(text, /NotSigned/);
    assert.match(page.scope.paragraphs[0] ?? '', /initial SignPath application scope remains|SignPath 初始申请范围仍是/u);
    assert.match(page.scope.paragraphs[0] ?? '', /Runtime.*nimi\.exe/);
    assert.match(page.scope.items?.join('\n') ?? '', /outside that initial SignPath request|不在该 SignPath 初始申请范围/u);
    assert.match(page.scope.items?.join('\n') ?? '', /third-party Apps|第三方 App/iu);
    assert.match(page.verificationChecks.join('\n'), /SHA-256/);
    assert.doesNotMatch(text, /SignPath (has|is) approved/i);
  }
});

test('historical cleanup is scoped to old builds and current Beta recovery uses its own guide', () => {
  for (const locale of ['en', 'zh'] as const) {
    const page = PUBLIC_PAGE_CONTENT[locale].policy;
    const cleanup = page.uninstall.paragraphs.join('\n');
    assert.match(cleanup, /Historical|历史/u);
    assert.match(cleanup, /Root/);
    assert.match(cleanup, /TrustedPublisher/);
    assert.match(page.uninstall.paragraphs[0] ?? '', /exact release|对应版本/u);
    assert.doesNotMatch(JSON.stringify(page), /v0\.2\.2-preview\.1/);
  }
});

test('public routes retain crawlable metadata and sitemap entries', () => {
  const router = readFileSync(new URL('../src/site-router.tsx', import.meta.url), 'utf8');
  const sitemap = readFileSync(new URL('../public/sitemap.xml', import.meta.url), 'utf8');
  const downloadHtml = readFileSync(new URL('../download.html', import.meta.url), 'utf8');
  const policyHtml = readFileSync(new URL('../code-signing.html', import.meta.url), 'utf8');
  const homeHtml = readFileSync(new URL('../home.html', import.meta.url), 'utf8');
  const appsHtml = readFileSync(new URL('../apps.html', import.meta.url), 'utf8');
  const platformHtml = readFileSync(new URL('../platform.html', import.meta.url), 'utf8');
  const developersHtml = readFileSync(new URL('../developers.html', import.meta.url), 'utf8');
  assert.match(router, /path="\/download"/);
  assert.match(router, /path="\/code-signing"/);
  assert.match(router, /path="\/download\.html"/);
  assert.match(sitemap, /https:\/\/nimi\.ai\/download/);
  assert.match(sitemap, /https:\/\/nimi\.ai\/code-signing/);
  assert.match(downloadHtml, /rel="canonical" href="https:\/\/nimi\.ai\/download"/);
  assert.match(policyHtml, /rel="canonical" href="https:\/\/nimi\.ai\/code-signing"/);
  assert.match(homeHtml, /rel="canonical" href="https:\/\/nimi\.ai\/home"/);
  assert.match(appsHtml, /rel="canonical" href="https:\/\/nimi\.ai\/apps"/);
  assert.match(platformHtml, /rel="canonical" href="https:\/\/nimi\.ai\/platform"/);
  assert.match(developersHtml, /rel="canonical" href="https:\/\/nimi\.ai\/developers"/);
  assert.match(downloadHtml, /property="og:title" content="Download Nimi/);
  assert.match(policyHtml, /property="og:title" content="Code signing policy/);
});

test('rendered download page presents Beta scope, signing and sign-in requirements before direct installer CTAs', () => {
  for (const locale of ['en', 'zh'] as const) {
    const html = renderToStaticMarkup(createElement(MemoryRouter, {}, createElement(DownloadPageView, {
      locale, onLocaleChange: () => {},
    })));
    const firstPrimaryAction = html.indexOf('class="release-primary-action"');
    const secondaryAction = html.indexOf('class="release-secondary-action" href="https://github.com/nimiplatform/nimi/releases"');
    const scope = html.indexOf('id="preview-scope"');
    const warning = html.indexOf('id="preview-warning"');
    assert.ok(firstPrimaryAction > 0 && secondaryAction > 0 && scope > 0 && warning > 0);
    assert.ok(scope < firstPrimaryAction && warning < firstPrimaryAction);
    assert.match(html, /aria-describedby="preview-scope preview-warning"/);
    assert.match(html.slice(scope, firstPrimaryAction), /0\.2\.4/);
    assert.match(html.slice(scope, firstPrimaryAction), /Nimi account|Nimi 账号/u);
    assert.match(html.slice(scope, firstPrimaryAction), /in your browser|在浏览器登录/u);
    assert.match(html.slice(warning, firstPrimaryAction), /SmartScreen|Windows 已保护你的电脑/u);
    assert.match(html.slice(warning, firstPrimaryAction), /no Authenticode signature|尚无 Authenticode 签名/u);
    assert.match(html.slice(warning, firstPrimaryAction), /Do not install a development root certificate|请勿为此安装开发根证书/u);

    const installers = [...html.matchAll(/<a\b[^>]*href="([^"]*\/releases\/download\/[^"]+)"[^>]*>/g)];
    assert.deepEqual(installers.map((match) => match[1]), [
      'https://github.com/nimiplatform/nimi/releases/download/nimi%2Fv0.2.4/Nimi-0.2.4-windows-amd64.exe',
      'https://github.com/nimiplatform/nimi/releases/download/nimi%2Fv0.2.4/Nimi-0.2.4-macos-arm64.pkg',
      'https://github.com/nimiplatform/nimi/releases/download/nimi%2Fv0.2.4/Nimi-0.2.4-windows-amd64.exe',
      'https://github.com/nimiplatform/nimi/releases/download/nimi%2Fv0.2.4/Nimi-0.2.4-macos-arm64.pkg',
    ]);
    assert.ok(warning < installers[0]!.index);
    assert.match(installers[2]![0], /aria-describedby="requirements-windows preview-warning"/);
    const desktopHeading = html.indexOf('id="download-desktop"');
    assert.ok(desktopHeading > 0 && desktopHeading < installers[2]!.index);
    const guideLabel = locale === 'zh' ? '安装说明与校验' : 'Installation and verification';
    const resources = html.slice(installers[3]!.index);
    assert.ok(resources.includes(`href="/code-signing?lang=${locale}"`));
    assert.ok(resources.includes(guideLabel));

    const macHtml = renderToStaticMarkup(createElement(MemoryRouter, {}, createElement(DownloadPageView, {
      locale, onLocaleChange: () => {}, initialPlatform: 'macos',
    })));
    const macHeroActions = macHtml.slice(0, macHtml.indexOf('id="download-desktop"'));
    assert.match(macHeroActions, /Nimi-0\.2\.4-macos-arm64\.pkg/);
    assert.doesNotMatch(macHeroActions, /Nimi-0\.2\.4-windows-amd64\.exe/);
  }
});

test('download and landing hero share the same background source', () => {
  const foundation = readFileSync(new URL('../src/foundation.css', import.meta.url), 'utf8');
  const story = readFileSync(new URL('../src/landing/story.css', import.meta.url), 'utf8');
  const site = readFileSync(new URL('../src/site.css', import.meta.url), 'utf8');
  assert.match(foundation, /--nimi-landing-hero-background:\s*radial-gradient/);
  assert.match(story, /\.story-hero::before\s*\{[^}]*background:\s*var\(--nimi-landing-hero-background\)/);
  assert.match(site, /\.download-page-shell\s*\{[^}]*background:\s*var\(--nimi-landing-hero-background\)/);
});
