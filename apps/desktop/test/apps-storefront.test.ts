import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { DesktopAppsEntry } from '../src/shell/renderer/features/apps/apps-panel-projection.js';
import {
  formatPackageByteSize,
  resolveEntryOrigin,
  resolveLocalDevStorefrontView,
  resolvePackageStorefrontView,
} from '../src/shell/renderer/features/apps/apps-storefront.js';

function makeEntry(sourceClass: 'verified' | 'user_imported', withCatalog = true): DesktopAppsEntry {
  const shaZh = 'a'.repeat(64);
  const shaEn = 'b'.repeat(64);
  return {
    identity: {
      entryKey: `${sourceClass}:nimi.shijing`,
      appId: 'nimi.shijing',
      sourceClass,
      displayName: '时镜',
      updatedAtUnixMs: 1,
    },
    catalogTarget: withCatalog && sourceClass === 'verified' ? {
      approvedTargetSelector: new Uint8Array([1]),
      observedRegistryRevision: 'c'.repeat(40),
      descriptorId: 'nimi.shijing@0.2.0',
      appId: 'nimi.shijing',
      displayName: '时镜',
      version: '0.2.0',
      publisherGithubNamespace: 'nimiplatform',
      sourceRepository: 'https://github.com/nimiplatform/nimiapp-shijing',
      sourceLicenseSpdxExpression: 'MIT',
      appAccess: ['runtime.consume'],
      capabilityContractRefs: ['text.generate'],
      requiredStandardizedFeatureRefs: [],
      storagePolicyKind: 'nimi-mediated-default',
      osStorageDisclosures: [],
      targetId: 'windows-x86_64',
      os: 'windows',
      arch: 'x86_64',
      assetName: 'nimi.shijing-0.2.0-windows-x86_64.nimiapp',
      assetSize: '125829120',
      executionProfileRef: 'windows-user-mode-as-invoker-v1',
      windowsCodeSigning: 'unsigned',
      macosNotarization: 'not-applicable',
      policyBlocked: false,
      policyRevision: '0',
      productOrigin: 'nimi-official',
      admissionTrustTier: 'community',
    } : null,
    localDevelopment: null,
    committedRelease: null,
    packageJob: null,
    run: null,
    aiConfigSummary: null,
    iconUrl: null,
    summary: '个人节律观察。',
    appInfo: {
      appId: 'nimi.shijing',
      version: '0.2.0',
      targetId: 'windows-x86_64',
      displayName: '时镜',
      summary: '个人节律观察。',
      iconPngBase64: '',
      readmeMarkdown: '# 时镜\n\n中文介绍。',
      releaseNotesMarkdown: 'Release 0.2.0',
      licenseIdentifier: 'MIT',
      licenseText: 'MIT',
      appAccess: ['runtime.consume'],
      capabilityContractRefs: ['text.generate'],
      requiredStandardizedFeatureRefs: [],
      storagePolicyKind: 'nimi-mediated-default',
      osStorageDisclosure: [],
      author: 'Nimi Team',
      homepageUrl: '',
      supportUrl: '',
      storefront: {
        category: 'companions-worlds',
        defaultLocale: 'zh',
        locales: [
          {
            locale: 'en',
            displayName: 'ShiJing',
            summary: 'Personal rhythm companion.',
            tags: ['Rhythm'],
            highlights: [{ title: 'Charting', description: 'Deterministic charts.' }],
            introductionMarkdown: '# ShiJing\n\nEnglish intro.',
          },
          {
            locale: 'zh',
            displayName: '',
            summary: '',
            tags: ['节律观察'],
            highlights: [{ title: '确定性排盘', description: '本地历法排盘。' }],
            introductionMarkdown: '',
          },
        ],
        media: {
          cover: {
            defaultImage: { mediaType: 'image/webp', width: 1280, height: 720, size: '64000', sha256: shaZh },
            locales: [{ locale: 'en', image: { mediaType: 'image/webp', width: 1280, height: 720, size: '64000', sha256: shaEn } }],
          },
          gallery: [{
            id: 'day-lens',
            kind: 'image',
            defaultImage: { mediaType: 'image/webp', width: 1280, height: 720, size: '64000', sha256: shaZh },
            locales: [{ locale: 'en', image: { mediaType: 'image/webp', width: 1280, height: 720, size: '64000', sha256: shaEn } }],
            caption: { zh: '日镜', en: 'Day Lens' },
          }],
        },
      },
    },
  };
}

describe('Desktop Apps Storefront projection', () => {
  it('reports an unreadable declared translation only in the affected language', () => {
    const entry = makeEntry('verified');
    const preview = {
      category: 'lifestyle', defaultLocale: 'zh', cover: null, gallery: [],
      locales: [{ locale: 'en', displayName: '', summary: '', highlights: [], tags: [], introductionMarkdown: null }],
    };
    const resolve = (language: string) => resolveLocalDevStorefrontView(entry, language, preview, '默认介绍');
    assert.equal(resolve('en').introductionMarkdown, null);
    assert.equal(resolve('en').introductionErrorField, 'metadata.storefront.locales.en.introduction');
    assert.equal(resolve('zh').introductionMarkdown, '默认介绍');
    assert.equal(resolve('fr').introductionMarkdown, '默认介绍');
    const regional = { ...preview, defaultLocale: 'en-GB' };
    assert.equal(resolveLocalDevStorefrontView(entry, 'en', regional, 'British intro').introductionMarkdown, null);
    assert.equal(resolveLocalDevStorefrontView(entry, 'en-GB', regional, 'British intro').introductionMarkdown, 'British intro');
  });

  it('resolves bilingual copy and verified media URLs by UI language', () => {
    const verified = makeEntry('verified');
    const zh = resolvePackageStorefrontView(verified, 'zh-CN');
    assert.equal(zh.displayName, '时镜');
    assert.equal(zh.summary, '个人节律观察。');
    assert.equal(zh.introductionMarkdown, '# 时镜\n\n中文介绍。');
    assert.equal(zh.coverUrl, `https://nimi.ai/.well-known/nimi-apps/media/nimi.shijing/${'a'.repeat(64)}.webp`);
    assert.equal(zh.gallery[0]?.caption, '日镜');

    const en = resolvePackageStorefrontView(verified, 'en-US');
    assert.equal(en.displayName, 'ShiJing');
    assert.equal(en.summary, 'Personal rhythm companion.');
    assert.equal(en.introductionMarkdown, '# ShiJing\n\nEnglish intro.');
    assert.equal(en.coverUrl, `https://nimi.ai/.well-known/nimi-apps/media/nimi.shijing/${'b'.repeat(64)}.webp`);
    assert.equal(en.gallery[0]?.caption, 'Day Lens');
  });

  it('strictly isolates user_imported packages from public media URLs while keeping offline bilingual text', () => {
    const imported = makeEntry('user_imported', false);
    const en = resolvePackageStorefrontView(imported, 'en-US');
    assert.equal(en.displayName, 'ShiJing');
    assert.equal(en.introductionMarkdown, '# ShiJing\n\nEnglish intro.');
    assert.equal(en.coverUrl, null);
    assert.deepEqual(en.gallery, []);
    assert.equal(resolveEntryOrigin(imported), null);
  });

  it('never falls back missing offline origin to community', () => {
    const offlineVerified = makeEntry('verified', false);
    assert.equal(resolveEntryOrigin(offlineVerified), null);
    const onlineVerified = makeEntry('verified', true);
    assert.equal(resolveEntryOrigin(onlineVerified), 'nimi-official');
    assert.equal(formatPackageByteSize('125829120'), '120.0 MB');
  });
});
