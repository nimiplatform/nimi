import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { PNG } from 'pngjs';
import { Transformer } from '@napi-rs/image';
import { readAppInfo, readAppStorefront, validateAppInfo } from '../lib/app-info.mjs';
import { aggregateAppTargetCandidates, packAppTarget, readNimiAppArchive } from '../lib/app-pack.mjs';
import {
  STOREFRONT_COVER_BOUNDS,
  STOREFRONT_GALLERY_BOUNDS,
  inspectStaticStorefrontImage,
} from '../lib/storefront-media.mjs';

function makePng(width, height) {
  const png = new PNG({ width, height });
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = 40;
    png.data[i + 1] = 120;
    png.data[i + 2] = 220;
    png.data[i + 3] = 255;
  }
  return PNG.sync.write(png);
}

function makeApng(width, height) {
  const base = makePng(width, height);
  // Insert an acTL chunk right after IHDR (8 sig + 25 IHDR = 33).
  const actl = Buffer.alloc(20);
  actl.writeUInt32BE(8, 0);
  actl.write('acTL', 4, 'ascii');
  actl.writeUInt32BE(2, 8);
  actl.writeUInt32BE(0, 12);
  return Buffer.concat([base.subarray(0, 33), actl, base.subarray(33)]);
}

function makeVp8LWebp(width, height) {
  return new Transformer(makePng(width, height)).webpLosslessSync();
}

function makeAnimatedWebp(width, height) {
  const vp8x = Buffer.alloc(10);
  vp8x[0] = 0x02; // Animation bit
  const w = width - 1;
  const h = height - 1;
  vp8x[4] = w & 0xff;
  vp8x[5] = (w >> 8) & 0xff;
  vp8x[6] = (w >> 16) & 0xff;
  vp8x[7] = h & 0xff;
  vp8x[8] = (h >> 8) & 0xff;
  vp8x[9] = (h >> 16) & 0xff;
  const h1 = Buffer.alloc(8);
  h1.write('VP8X', 0, 'ascii');
  h1.writeUInt32LE(10, 4);
  const body = Buffer.concat([Buffer.from('WEBP', 'ascii'), h1, vp8x]);
  const riff = Buffer.alloc(8);
  riff.write('RIFF', 0, 'ascii');
  riff.writeUInt32LE(body.length, 4);
  return Buffer.concat([riff, body]);
}

test('inspectStaticStorefrontImage validates PNG and WebP and rejects animation or invalid bounds', () => {
  const validPng = makePng(1280, 720);
  const pngRef = inspectStaticStorefrontImage(validPng, STOREFRONT_COVER_BOUNDS, 'cover');
  assert.equal(pngRef.media_type, 'image/png');
  assert.equal(pngRef.width, 1280);
  assert.equal(pngRef.height, 720);

  const validWebp = makeVp8LWebp(1280, 720);
  const webpRef = inspectStaticStorefrontImage(validWebp, STOREFRONT_COVER_BOUNDS, 'cover');
  assert.equal(webpRef.media_type, 'image/webp');
  assert.equal(webpRef.width, 1280);
  assert.equal(webpRef.height, 720);
  const lossy = new Transformer(validPng).webpSync();
  assert.equal(inspectStaticStorefrontImage(lossy, STOREFRONT_COVER_BOUNDS).width, 1280);
  // RIFF and VP8L headers describe a 1280x720 image, but there are no decodable pixels.
  const headerOnly = Buffer.from('5249464612000000574542505650384c060000002fffC4b30000', 'hex');
  assert.throws(() => inspectStaticStorefrontImage(headerOnly, STOREFRONT_COVER_BOUNDS), /pixels could not be decoded/);

  assert.throws(() => inspectStaticStorefrontImage(makeApng(1280, 720), STOREFRONT_COVER_BOUNDS, 'cover'), /APNG/);
  assert.throws(() => inspectStaticStorefrontImage(makeAnimatedWebp(1280, 720), STOREFRONT_COVER_BOUNDS, 'cover'), /animated WebP/);
  assert.throws(() => inspectStaticStorefrontImage(Buffer.from('GIF89a0000000000'), STOREFRONT_COVER_BOUNDS, 'cover'), /static WebP or PNG/);
  assert.throws(() => inspectStaticStorefrontImage(makeVp8LWebp(708, 357), STOREFRONT_COVER_BOUNDS, 'cover'), /outside allowed bounds/);
  assert.throws(() => inspectStaticStorefrontImage(makeVp8LWebp(600, 340), STOREFRONT_GALLERY_BOUNDS, 'gallery'), /outside allowed bounds/);
  const oversizedWebp = Buffer.concat([validWebp, Buffer.alloc(512 * 1024)]);
  assert.throws(() => inspectStaticStorefrontImage(oversizedWebp, STOREFRONT_COVER_BOUNDS, 'cover'), /at most 524288 bytes/);
});

test('authoring rejects a scalar tag without converting it to characters', () => {
  const metadata = { storefront: { category: 'lifestyle', default_locale: 'zh', locales: { zh: { tags: '生活' } } } };
  assert.throws(() => readAppStorefront('.', { metadata }), /storefront.locales.zh.tags/);
});

test('packAppTarget and aggregateAppTargetCandidates produce storefront-media.zip outside .nimiapp without archive digest in app-info', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'nimi-storefront-pack-'));
  try {
    mkdirSync(path.join(dir, 'assets/storefront'), { recursive: true });
    mkdirSync(path.join(dir, '.nimi/config'), { recursive: true });
    mkdirSync(path.join(dir, 'dist-win'), { recursive: true });

    const iconBytes = makePng(256, 256);
    const coverZh = makeVp8LWebp(1280, 720);
    const coverEn = makeVp8LWebp(1600, 900);
    const shot1 = makeVp8LWebp(1280, 720); // Intentionally identical bytes to coverZh to verify deduplication!
    writeFileSync(path.join(dir, 'assets/icon.png'), iconBytes);
    writeFileSync(path.join(dir, 'assets/storefront/cover-zh.webp'), coverZh);
    writeFileSync(path.join(dir, 'assets/storefront/cover-en.webp'), coverEn);
    writeFileSync(path.join(dir, 'assets/storefront/shot-1.webp'), shot1);
    writeFileSync(path.join(dir, 'LICENSE'), 'MIT License\n');
    writeFileSync(path.join(dir, 'NIMI_APP.md'), '# 时镜\n\n中文介绍。');
    writeFileSync(path.join(dir, 'NIMI_APP.en.md'), '# ShiJing\n\nEnglish introduction.');
    writeFileSync(path.join(dir, 'RELEASE_NOTES.md'), 'Initial storefront release.');
    writeFileSync(path.join(dir, 'dist-win/shijing.exe'), Buffer.from('MZ-stub-exe'));
    writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'shijing', version: '0.2.0', license: 'MIT' }));
    writeFileSync(path.join(dir, '.nimi/config/build-profile.yaml'), [
      'format: nimi.app-build-profile/v1',
      'build_profile_ref: electron-pnpm',
      'targets:',
      '  windows-x86_64:',
      '    os: windows',
      '    arch: x86_64',
      '    payload_path: dist-win',
      '    runtime_entry: payload/shijing.exe',
      '    native_trust:',
      '      posture: production-unsigned',
      '      windows_authenticode: unsigned',
      '      certificate_subject: null',
      '    execution_profile:',
      '      requested_execution_level: asInvoker',
      '      ui_access: false',
    ].join('\n'));
    writeFileSync(path.join(dir, 'nimi.app.yaml'), [
      'app_id: nimi.shijing',
      'display_name: 时镜',
      'version: 0.2.0',
      'app_access:',
      '  - runtime.consume',
      'capability_contract_refs:',
      '  - text.generate',
      'required_standardized_feature_refs: []',
      'storage_policy:',
      '  kind: nimi-mediated-default',
      'metadata:',
      '  summary: 个人节律观察与解读。',
      '  icon: assets/icon.png',
      '  release_notes: RELEASE_NOTES.md',
      '  storefront:',
      '    category: lifestyle',
      '    default_locale: zh',
      '    locales:',
      '      zh:',
      '        tags: ["节律观察", "六大透镜"]',
      '        highlights:',
      '          - title: 确定性排盘',
      '            description: 本地复现四柱与节气计算。',
      '      en:',
      '        display_name: ShiJing',
      '        summary: Personal rhythm companion.',
      '        tags: ["Rhythm"]',
      '        introduction: NIMI_APP.en.md',
      '        highlights:',
      '          - title: Deterministic Charting',
      '            description: Reproducible local calendar calculations.',
      '    media:',
      '      cover:',
      '        path: assets/storefront/cover-zh.webp',
      '        locales:',
      '          en: assets/storefront/cover-en.webp',
      '      gallery:',
      '        - id: day-lens',
      '          kind: image',
      '          path: assets/storefront/shot-1.webp',
      '          caption:',
      '            zh: 日镜',
      '            en: Day Lens',
    ].join('\n'));

    const info = readAppInfo(dir, 'windows-x86_64');
    assert.equal(info.storefront.category, 'lifestyle');
    assert.equal(info.storefront.locales.en.introduction_markdown, '# ShiJing\n\nEnglish introduction.');
    assert.equal(Object.hasOwn(info.storefront.media, 'archive_sha256'), false);
    assert.throws(() => validateAppInfo({
      ...info,
      storefront: { ...info.storefront, media: { ...info.storefront.media, archive_sha256: 'a'.repeat(64) } },
    }), /unsupported field: archive_sha256/);

    const packed = packAppTarget(dir, { target: 'windows-x86_64' });
    const appEntries = readNimiAppArchive(readFileSync(packed.artifactPath));
    assert.equal([...appEntries.keys()].some((k) => k.includes('storefront')), false);
    assert.equal(existsSync(path.join(dir, 'dist/nimi-app/nimi.shijing-0.2.0-storefront-media.zip')), false);

    const aggregated = aggregateAppTargetCandidates(dir);
    assert.ok(aggregated.storefront_media);
    assert.equal(aggregated.storefront_media.asset_name, 'nimi.shijing-0.2.0-storefront-media.zip');
    const zipBytes = readFileSync(aggregated.storefrontMediaPath);
    assert.equal(createHash('sha256').update(zipBytes).digest('hex'), aggregated.storefront_media.sha256);
    const mediaEntries = readNimiAppArchive(zipBytes);
    // coverZh === shot1, so only 2 deduplicated files should be inside the zip.
    assert.equal(mediaEntries.size, 2);
    const zhSha = createHash('sha256').update(coverZh).digest('hex');
    const enSha = createHash('sha256').update(coverEn).digest('hex');
    assert.deepEqual([...mediaEntries.keys()].sort(), [`${zhSha}.webp`, `${enSha}.webp`].sort());

    // Mutating repo storefront image after target packing must fail aggregate.
    writeFileSync(path.join(dir, 'assets/storefront/cover-en.webp'), makeVp8LWebp(1440, 810));
    assert.throws(() => aggregateAppTargetCandidates(dir), /changed after target packing/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
