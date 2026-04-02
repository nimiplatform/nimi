import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildTranscriptionSegments,
  buildFoodExtractionPrompt,
  containsLikelyTraditionalChinese,
  extractBvid,
  resolveConfiguredSttTarget,
  resolveConfiguredTextTarget,
  resolveSttModel,
  computeExtractionCoverage,
  filterCommentCluesForExtraction,
  mergeCommentCluesIntoExtraction,
  splitWaveIntoSegments,
} from './lib/bilibili-food-video-probe.mts';

function buildTestWave(sampleRate: number, samples: number[]): Uint8Array {
  const channelCount = 1;
  const bitsPerSample = 16;
  const pcmData = Buffer.alloc(samples.length * 2);
  samples.forEach((sample, index) => {
    pcmData.writeInt16LE(sample, index * 2);
  });
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + pcmData.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channelCount, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * channelCount * (bitsPerSample / 8), 28);
  header.writeUInt16LE(channelCount * (bitsPerSample / 8), 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(pcmData.length, 40);
  return new Uint8Array(Buffer.concat([header, pcmData]));
}

test('extractBvid supports full bilibili urls', () => {
  assert.equal(
    extractBvid('https://www.bilibili.com/video/BV1P2Awz6EUQ/?spm_id_from=333.337.search-card.all.click'),
    'BV1P2Awz6EUQ',
  );
});

test('extractBvid supports raw bvid input', () => {
  assert.equal(extractBvid('BV1P2Awz6EUQ'), 'BV1P2Awz6EUQ');
});

test('containsLikelyTraditionalChinese detects obvious traditional-only characters', () => {
  assert.equal(containsLikelyTraditionalChinese('从化田边村新村'), false);
  assert.equal(containsLikelyTraditionalChinese('從化田邊村新村'), true);
  assert.equal(containsLikelyTraditionalChinese('肉肠粉'), false);
  assert.equal(containsLikelyTraditionalChinese('肉腸粉'), true);
});

test('resolveSttModel keeps configured stt model for long audio when no long-audio override exists', () => {
  assert.equal(
    resolveSttModel({
      durationSec: 1167,
      mergedEnv: {
        NIMI_LIVE_DASHSCOPE_STT_MODEL_ID: 'qwen3-asr-flash-2026-02-10',
      },
    }),
    'cloud/qwen3-asr-flash-2026-02-10',
  );
});

test('resolveSttModel keeps standard stt model for short audio', () => {
  assert.equal(
    resolveSttModel({
      durationSec: 120,
      mergedEnv: {
        NIMI_LIVE_DASHSCOPE_STT_MODEL_ID: 'qwen3-asr-flash-2026-02-10',
      },
    }),
    'cloud/qwen3-asr-flash-2026-02-10',
  );
});

test('resolveConfiguredSttTarget prefers saved local route setting', () => {
  process.env.NIMI_VIDEO_FOOD_MAP_SETTINGS_JSON = JSON.stringify({
    stt: {
      routeSource: 'local',
      connectorId: '',
      model: 'local/whisper-large-v3',
    },
    text: {
      routeSource: 'cloud',
      connectorId: '',
      model: '',
    },
  });
  assert.deepEqual(
    resolveConfiguredSttTarget({
      durationSec: 120,
      mergedEnv: {},
    }),
    {
      route: 'local',
      model: 'local/whisper-large-v3',
    },
  );
  delete process.env.NIMI_VIDEO_FOOD_MAP_SETTINGS_JSON;
});

test('resolveConfiguredTextTarget prefers saved cloud connector route setting', () => {
  process.env.NIMI_VIDEO_FOOD_MAP_SETTINGS_JSON = JSON.stringify({
    stt: {
      routeSource: 'cloud',
      connectorId: '',
      model: '',
    },
    text: {
      routeSource: 'cloud',
      connectorId: 'conn-openai',
      model: 'gpt-4.1-mini',
    },
  });
  assert.deepEqual(
    resolveConfiguredTextTarget({
      mergedEnv: {},
    }),
    {
      route: 'cloud',
      connectorId: 'conn-openai',
      model: 'gpt-4.1-mini',
    },
  );
  delete process.env.NIMI_VIDEO_FOOD_MAP_SETTINGS_JSON;
});

test('computeExtractionCoverage returns full for short videos', () => {
  const coverage = computeExtractionCoverage(120);
  assert.equal(coverage.state, 'full');
  assert.equal(coverage.processedSegmentCount, 1);
  assert.equal(coverage.processedDurationSec, 120);
  assert.equal(coverage.totalDurationSec, 120);
});

test('computeExtractionCoverage returns leading_segments_only for long videos', () => {
  const coverage = computeExtractionCoverage(1167);
  assert.equal(coverage.state, 'leading_segments_only');
  assert.equal(coverage.processedSegmentCount, 3);
  assert.equal(coverage.processedDurationSec, 720);
  assert.equal(coverage.totalDurationSec, 1167);
});

test('splitWaveIntoSegments slices pcm wav by time window', () => {
  const wav = buildTestWave(2, [100, 200, 300, 400, 500, 600]);
  const segments = splitWaveIntoSegments({
    wavBytes: wav,
    segmentDurationSec: 2,
    maxSegments: 2,
  });
  assert.equal(segments.length, 2);
  assert.equal(segments[0]?.startSec, 0);
  assert.equal(segments[0]?.endSec, 2);
  assert.equal(segments[1]?.startSec, 2);
  assert.equal(segments[1]?.endSec, 3);
  assert.equal(segments[0]?.mimeType, 'audio/wav');
  assert.equal(segments[1]?.mimeType, 'audio/wav');
});

test('buildTranscriptionSegments caps oversized direct audio fallback under grpc limit', () => {
  const audioBytes = new Uint8Array((7 * 1024 * 1024) + 1024);
  const segments = buildTranscriptionSegments({
    shouldSegment: false,
    durationSec: 120,
    audioBytes,
    audioMimeType: 'audio/mp4',
  });
  assert.equal(segments.length, 1);
  assert.ok((segments[0]?.bytes.byteLength || 0) <= 6 * 1024 * 1024);
  assert.ok((segments[0]?.endSec || 0) < 120);
});

test('filterCommentCluesForExtraction keeps venue and address hints from public comments', () => {
  const clues = filterCommentCluesForExtraction({
    extractionJson: {
      venues: [
        {
          venue_name: '炭火小馆',
        },
      ],
    },
    comments: [
      {
        rpid: 1,
        like: 88,
        ctime: 1_712_345_678,
        member: { uname: '路人甲' },
        content: { message: '炭火小馆就在体育西路123号，下午去不用排太久。' },
      },
      {
        rpid: 2,
        like: 0,
        ctime: 1_712_345_600,
        member: { uname: '路人乙' },
        content: { message: '这个视频拍得不错。' },
      },
    ],
  });
  assert.equal(clues.length, 1);
  assert.equal(clues[0]?.authorName, '路人甲');
  assert.deepEqual(clues[0]?.matchedVenueNames, ['炭火小馆']);
  assert.equal(clues[0]?.addressHint, '体育西路123号');
});

test('mergeCommentCluesIntoExtraction fills a missing address when comments agree', () => {
  const merged = mergeCommentCluesIntoExtraction({
    extractionJson: {
      video_summary: '在吃烤鸡翅',
      venues: [
        {
          venue_name: '炭火小馆',
          address_text: '',
          recommended_dishes: ['烤鸡翅'],
          evidence: ['鸡翅很好吃'],
          needs_review: false,
        },
      ],
      uncertain_points: [],
    },
    commentClues: [
      {
        commentId: 'c1',
        authorName: '路人甲',
        message: '炭火小馆就在体育西路123号。',
        likeCount: 50,
        publishedAt: '2026-03-31T12:00:00.000Z',
        matchedVenueNames: ['炭火小馆'],
        addressHint: '体育西路123号',
      },
    ],
  });
  const venue = Array.isArray(merged?.venues) ? merged?.venues[0] as Record<string, unknown> : null;
  assert.equal(venue?.address_text, '体育西路123号');
  assert.ok(Array.isArray(venue?.evidence));
  assert.ok((venue?.evidence as unknown[]).some((entry) => String(entry).includes('评论补充')));
});

test('filterCommentCluesForExtraction splits multi-venue address lists into separate clues', () => {
  const clues = filterCommentCluesForExtraction({
    extractionJson: {
      venues: [
        { venue_name: '' },
      ],
    },
    comments: [
      {
        rpid: 9,
        like: 8,
        ctime: 1_712_345_905,
        member: { uname: '课代表' },
        content: {
          message: '✨本期🔍探访5家店✨ 🏠周末美食 ，📍位于：北海市·北海大道泰华小区六巷1号 🏠拾肆牛腩猪脚粉(人均15.0元) ，📍位于：北海市·中山路与光明里一巷交叉口西60米 🏠张氏卷筒粉(人均8.0元) ，📍位于：北海市·海洋小区路口张氏卷筒粉',
        },
      },
    ],
  });
  assert.ok(clues.length >= 3);
  assert.ok(clues.some((clue) => clue.matchedVenueNames.includes('周末美食') && clue.addressHint.includes('泰华小区六巷1号')));
  assert.ok(clues.some((clue) => clue.matchedVenueNames.includes('拾肆牛腩猪脚粉') && clue.addressHint.includes('光明里一巷')));
  assert.ok(clues.some((clue) => clue.matchedVenueNames.includes('张氏卷筒粉') && clue.addressHint.includes('海洋小区路口')));
});

test('mergeCommentCluesIntoExtraction creates review venues from repeated comment-only clues', () => {
  const merged = mergeCommentCluesIntoExtraction({
    extractionJson: {
      video_summary: '北海粉店合集',
      venues: [],
      uncertain_points: [],
    },
    commentClues: [
      {
        commentId: 'c2',
        authorName: '课代表A',
        message: '费姐正宗蟹仔粉店在亚平村委会美食城桥乡路29号一楼。',
        likeCount: 8,
        publishedAt: '2026-03-31T12:00:00.000Z',
        matchedVenueNames: ['费姐正宗蟹仔粉店'],
        addressHint: '北海市亚平村委会美食城桥乡路29号一楼',
      },
      {
        commentId: 'c3',
        authorName: '课代表B',
        message: '第五家费姐正宗蟹仔粉店。',
        likeCount: 38,
        publishedAt: '2026-03-31T12:10:00.000Z',
        matchedVenueNames: ['费姐正宗蟹仔粉店'],
        addressHint: '',
      },
    ],
  });
  const venues = Array.isArray(merged?.venues) ? merged.venues as Array<Record<string, unknown>> : [];
  const venue = venues.find((entry) => String(entry.venue_name || '') === '费姐正宗蟹仔粉店');
  assert.ok(venue);
  assert.equal(venue?.address_text, '北海市亚平村委会美食城桥乡路29号一楼');
  assert.equal(venue?.needs_review, true);
});

test('buildFoodExtractionPrompt sends full raw comments plus local hint summary in one pass', () => {
  const prompt = buildFoodExtractionPrompt({
    metadata: {
      bvid: 'BV1test',
      aid: '1',
      cid: '1',
      title: '北海六家必吃粉店',
      ownerMid: '123',
      ownerName: '米雪食记',
      durationSec: 120,
      description: '',
      tags: ['北海', '粉店'],
      canonicalUrl: 'https://www.bilibili.com/video/BV1test/',
    },
    transcript: '第一家海鲜粉，第二家猪脚粉，第三家卷筒粉。',
    commentClues: [
      {
        commentId: 'raw-1#1',
        authorName: '课代表',
        message: '✨本期🔍探访5家店✨ 🏠周末美食 ，📍位于：北海市·北海大道泰华小区六巷1号 🏠拾肆牛腩猪脚粉(人均15.0元) ，📍位于：北海市·中山路与光明里一巷交叉口西60米',
        likeCount: 8,
        publishedAt: '2026-03-31T12:00:00.000Z',
        matchedVenueNames: ['周末美食'],
        addressHint: '北海市北海大道泰华小区六巷1号',
      },
      {
        commentId: 'raw-1#2',
        authorName: '课代表',
        message: '✨本期🔍探访5家店✨ 🏠周末美食 ，📍位于：北海市·北海大道泰华小区六巷1号 🏠拾肆牛腩猪脚粉(人均15.0元) ，📍位于：北海市·中山路与光明里一巷交叉口西60米',
        likeCount: 8,
        publishedAt: '2026-03-31T12:00:00.000Z',
        matchedVenueNames: ['拾肆牛腩猪脚粉'],
        addressHint: '北海市中山路与光明里一巷交叉口西60米',
      },
    ],
  });

  assert.match(prompt, /视频转写是主证据，评论是补充证据/);
  assert.match(prompt, /评论原文：/);
  assert.match(prompt, /本地提取到的可能店名：周末美食、拾肆牛腩猪脚粉/);
  assert.match(prompt, /本地提取到的可能地址：北海市北海大道泰华小区六巷1号；北海市中山路与光明里一巷交叉口西60米/);
  assert.match(prompt, /评论原文比本地提取的辅助线索更重要/);
});

test('filterCommentCluesForExtraction keeps comment-only venue names for cross-check', () => {
  const clues = filterCommentCluesForExtraction({
    extractionJson: {
      venues: [
        {
          venue_name: '',
        },
      ],
    },
    comments: [
      {
        rpid: 3,
        like: 4,
        ctime: 1_712_345_800,
        member: { uname: '吃咩啊啊' },
        content: { message: '本期：文联文兴小食店 荔蜜园餐厅 我做了地图，能查具体地址。' },
      },
    ],
  });
  assert.equal(clues.length, 1);
  assert.deepEqual(clues[0]?.matchedVenueNames, ['文联文兴小食店', '荔蜜园餐厅']);
});

test('filterCommentCluesForExtraction drops obvious ask-only and chat-only noise', () => {
  const clues = filterCommentCluesForExtraction({
    extractionJson: {
      venues: [
        {
          venue_name: '',
        },
      ],
    },
    comments: [
      {
        rpid: 4,
        like: 1,
        ctime: 1_712_345_900,
        member: { uname: '路人甲' },
        content: { message: '求店名' },
      },
      {
        rpid: 5,
        like: 1,
        ctime: 1_712_345_901,
        member: { uname: '路人乙' },
        content: { message: '求咩酒店' },
      },
      {
        rpid: 6,
        like: 3,
        ctime: 1_712_345_902,
        member: { uname: '吃咩啊啊' },
        content: { message: '本期：文联文兴小食店 荔蜜园餐厅 我做了地图。' },
      },
    ],
  });
  assert.equal(clues.length, 1);
  assert.deepEqual(clues[0]?.matchedVenueNames, ['文联文兴小食店', '荔蜜园餐厅']);
});

test('filterCommentCluesForExtraction keeps liked generic comments in the wider candidate pool', () => {
  const clues = filterCommentCluesForExtraction({
    extractionJson: {
      venues: [
        {
          venue_name: '',
        },
      ],
    },
    comments: [
      {
        rpid: 7,
        like: 3,
        ctime: 1_712_345_903,
        member: { uname: '路人丙' },
        content: { message: '这一家牛腩面看起来真的很不错，下次去从化想试试。' },
      },
    ],
  });
  assert.equal(clues.length, 1);
  assert.equal(clues[0]?.message, '这一家牛腩面看起来真的很不错，下次去从化想试试。');
});

test('filterCommentCluesForExtraction still drops zero-like generic chatter', () => {
  const clues = filterCommentCluesForExtraction({
    extractionJson: {
      venues: [
        {
          venue_name: '',
        },
      ],
    },
    comments: [
      {
        rpid: 8,
        like: 0,
        ctime: 1_712_345_904,
        member: { uname: '路人丁' },
        content: { message: '这一家牛腩面看起来真的很不错，下次去从化想试试。' },
      },
    ],
  });
  assert.equal(clues.length, 0);
});
