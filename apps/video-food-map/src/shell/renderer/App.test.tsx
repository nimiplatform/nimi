import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ImportRecord,
  VideoFoodMapRuntimeOptions,
  VideoFoodMapSettings,
  VideoFoodMapSnapshot,
  VenueRecord,
} from './data/types.js';
import { App } from './App.js';

const apiMocks = vi.hoisted(() => ({
  importCreator: vi.fn(),
  importVideo: vi.fn(),
  loadSnapshot: vi.fn(),
  loadVideoFoodMapRuntimeOptions: vi.fn(),
  loadVideoFoodMapSettings: vi.fn(),
  openExternalUrl: vi.fn(),
  retryImport: vi.fn(),
  saveVideoFoodMapSettings: vi.fn(),
  setVenueConfirmation: vi.fn(),
  startVideoFoodMapWindowDrag: vi.fn(),
  toggleVenueFavorite: vi.fn(),
}));

vi.mock('@renderer/data/api.js', () => apiMocks);

vi.mock('@renderer/components/map-surface.js', () => ({
  MapSurface: () => <div data-testid="map-surface">map</div>,
}));

function buildVenue(overrides: Partial<VenueRecord> = {}): VenueRecord {
  return {
    id: 'venue-1',
    importId: 'import-1',
    venueName: '天巢法国餐厅',
    addressText: '澳门葡京路新葡京酒店43楼',
    recommendedDishes: ['红虾华夫饼'],
    cuisineTags: ['法餐'],
    flavorTags: ['松露'],
    evidence: ['视频里反复提到这家在新葡京43楼。'],
    confidence: 'high',
    recommendationPolarity: 'positive',
    needsReview: false,
    reviewState: 'map_ready',
    geocodeStatus: 'resolved',
    geocodeQuery: '天巢法国餐厅 澳门新葡京',
    latitude: 22.18758,
    longitude: 113.54878,
    userConfirmed: false,
    isFavorite: false,
    createdAt: '2026-04-01T10:00:00.000Z',
    updatedAt: '2026-04-01T10:00:00.000Z',
    ...overrides,
  };
}

function buildImport(overrides: Partial<ImportRecord> = {}): ImportRecord {
  return {
    id: 'import-1',
    sourceUrl: 'https://www.bilibili.com/video/BV1xx411c7mD',
    canonicalUrl: 'https://www.bilibili.com/video/BV1xx411c7mD',
    bvid: 'BV1xx411c7mD',
    title: '澳门法餐探店',
    creatorName: '米雪食记',
    creatorMid: '123',
    description: '作者去澳门吃法餐',
    tags: ['法餐', '澳门'],
    durationSec: 500,
    status: 'succeeded',
    transcript: '这里真的很好吃。',
    extractionRaw: '',
    videoSummary: '这条视频主推澳门一家法餐厅。',
    uncertainPoints: [],
    audioSourceUrl: '',
    selectedSttModel: 'cloud/whisper',
    selectedTextModel: 'cloud/gpt',
    extractionCoverage: null,
    outputDir: '',
    publicCommentCount: 12,
    commentClues: [{
      commentId: 'comment-1',
      authorName: '用户甲',
      message: '这家就在新葡京43楼。',
      likeCount: 12,
      publishedAt: '2026-04-01T10:00:00.000Z',
      matchedVenueNames: ['天巢法国餐厅'],
      addressHint: '新葡京43楼',
    }],
    errorMessage: '',
    createdAt: '2026-04-01T10:00:00.000Z',
    updatedAt: '2026-04-01T10:00:00.000Z',
    venues: [buildVenue()],
    ...overrides,
  };
}

function buildSnapshot(imports: ImportRecord[]): VideoFoodMapSnapshot {
  return {
    imports,
    mapPoints: imports.flatMap((record) =>
      record.venues
        .filter((venue) => venue.latitude != null && venue.longitude != null && (venue.userConfirmed || venue.reviewState === 'map_ready'))
        .map((venue) => ({
          venueId: venue.id,
          importId: record.id,
          venueName: venue.venueName,
          creatorName: record.creatorName,
          title: record.title,
          addressText: venue.addressText,
          latitude: venue.latitude!,
          longitude: venue.longitude!,
          isFavorite: venue.isFavorite,
          userConfirmed: venue.userConfirmed,
        })),
    ),
    creatorSyncs: [{
      creatorMid: '123',
      creatorName: '米雪食记',
      sourceUrl: 'https://space.bilibili.com/123',
      lastSyncedAt: '2026-04-01T10:00:00.000Z',
      lastScannedCount: 6,
      lastQueuedCount: 2,
      lastSkippedExistingCount: 4,
      createdAt: '2026-04-01T10:00:00.000Z',
      updatedAt: '2026-04-01T10:00:00.000Z',
    }],
    stats: {
      importCount: imports.length,
      succeededCount: imports.filter((item) => item.status === 'succeeded').length,
      failedCount: imports.filter((item) => item.status === 'failed').length,
      venueCount: imports.reduce((sum, item) => sum + item.venues.length, 0),
      mappedVenueCount: imports.reduce((sum, item) => sum + item.venues.filter((venue) => venue.reviewState === 'map_ready' || venue.userConfirmed).length, 0),
      reviewVenueCount: imports.reduce((sum, item) => sum + item.venues.filter((venue) => !venue.userConfirmed && venue.reviewState !== 'map_ready').length, 0),
      confirmedVenueCount: imports.reduce((sum, item) => sum + item.venues.filter((venue) => venue.userConfirmed).length, 0),
      favoriteVenueCount: imports.reduce((sum, item) => sum + item.venues.filter((venue) => venue.isFavorite).length, 0),
    },
  };
}

const defaultSettings: VideoFoodMapSettings = {
  stt: { routeSource: 'cloud', connectorId: 'openai', model: 'cloud/whisper' },
  text: { routeSource: 'cloud', connectorId: 'openai', model: 'cloud/gpt' },
  diningProfile: {
    dietaryRestrictions: [],
    tabooIngredients: [],
    flavorPreferences: [],
    cuisinePreferences: [],
  },
};

const defaultRuntimeOptions: VideoFoodMapRuntimeOptions = {
  stt: {
    options: [{
      key: 'stt-1',
      capability: 'audio.transcribe',
      source: 'cloud',
      connectorId: 'openai',
      connectorLabel: 'OpenAI',
      provider: 'openai',
      modelId: 'cloud/whisper',
      modelLabel: 'Whisper',
    }],
    loadStatus: 'ready',
    issues: [],
  },
  text: {
    options: [{
      key: 'text-1',
      capability: 'text.generate',
      source: 'cloud',
      connectorId: 'openai',
      connectorLabel: 'OpenAI',
      provider: 'openai',
      modelId: 'cloud/gpt',
      modelLabel: 'GPT',
    }],
    loadStatus: 'ready',
    issues: [],
  },
};

beforeEach(() => {
  apiMocks.importCreator.mockResolvedValue({
    creatorMid: '123',
    creatorName: '米雪食记',
    sourceUrl: 'https://space.bilibili.com/123',
    scannedCount: 4,
    queuedCount: 2,
    skippedExistingCount: 2,
    items: [],
  });
  apiMocks.importVideo.mockResolvedValue(buildImport());
  apiMocks.loadSnapshot.mockResolvedValue(buildSnapshot([buildImport()]));
  apiMocks.loadVideoFoodMapSettings.mockResolvedValue(defaultSettings);
  apiMocks.loadVideoFoodMapRuntimeOptions.mockResolvedValue(defaultRuntimeOptions);
  apiMocks.openExternalUrl.mockResolvedValue(undefined);
  apiMocks.retryImport.mockResolvedValue(buildImport());
  apiMocks.saveVideoFoodMapSettings.mockResolvedValue(defaultSettings);
  apiMocks.setVenueConfirmation.mockResolvedValue(buildImport());
  apiMocks.startVideoFoodMapWindowDrag.mockResolvedValue(undefined);
  apiMocks.toggleVenueFavorite.mockResolvedValue(buildImport());
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Video Food Map App', () => {
  it('routes a video link through the unified intake input', async () => {
    render(<App />);

    const user = userEvent.setup();
    await screen.findByText('视频清单');
    await user.type(screen.getByPlaceholderText('粘贴 Bilibili 视频链接或博主主页...'), 'https://www.bilibili.com/video/BV1xx411c7mD');
    await user.click(screen.getByRole('button', { name: /\+?\s*解析提取/ }));

    await waitFor(() => expect(apiMocks.importVideo).toHaveBeenCalledWith('https://www.bilibili.com/video/BV1xx411c7mD'));
    expect(apiMocks.importCreator).not.toHaveBeenCalled();
  });

  it('routes a creator page through the unified intake input', async () => {
    render(<App />);

    const user = userEvent.setup();
    await screen.findByText('视频清单');
    await user.type(screen.getByPlaceholderText('粘贴 Bilibili 视频链接或博主主页...'), 'https://space.bilibili.com/123456');
    await user.click(screen.getByRole('button', { name: /\+?\s*同步最近视频/ }));

    await waitFor(() => expect(apiMocks.importCreator).toHaveBeenCalledWith('https://space.bilibili.com/123456'));
    expect(apiMocks.importVideo).not.toHaveBeenCalled();
  });

  it('keeps navigation working across primary surfaces', async () => {
    const reviewImport = buildImport({
      venues: [buildVenue({
        id: 'review-nav',
        reviewState: 'review',
        geocodeStatus: 'failed',
        latitude: null,
        longitude: null,
      })],
    });
    apiMocks.loadSnapshot.mockResolvedValue(buildSnapshot([reviewImport]));

    render(<App />);

    const user = userEvent.setup();
    await screen.findByText('视频清单');
    await user.click(screen.getByRole('button', { name: '待确认' }));
    expect(await screen.findByText('待确认队列')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '偏好设置' }));
    expect(await screen.findByText('偏好与设置')).toBeInTheDocument();
  });

  it('preserves review actions and can jump back to details', async () => {
    const reviewImport = buildImport({
      venues: [
        buildVenue({
          id: 'review-1',
          reviewState: 'review',
          geocodeStatus: 'failed',
          latitude: null,
          longitude: null,
          venueName: '阿婆牛杂',
        }),
        buildVenue({
          id: 'review-2',
          reviewState: 'review',
          geocodeStatus: 'skipped',
          latitude: null,
          longitude: null,
          venueName: '芳村糖水铺',
        }),
      ],
    });
    apiMocks.loadSnapshot.mockResolvedValue(buildSnapshot([reviewImport]));
    apiMocks.setVenueConfirmation.mockResolvedValue(reviewImport);
    apiMocks.toggleVenueFavorite.mockResolvedValue(reviewImport);

    render(<App />);

    const user = userEvent.setup();
    await screen.findByText('视频清单');
    await user.click(screen.getByRole('button', { name: '待确认' }));
    expect((await screen.findAllByText('阿婆牛杂')).length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: '确认收录' }));
    await waitFor(() => expect(apiMocks.setVenueConfirmation).toHaveBeenCalledWith('review-1', true));

    await user.click(screen.getByRole('button', { name: '加入收藏' }));
    await waitFor(() => expect(apiMocks.toggleVenueFavorite).toHaveBeenCalledWith('review-1'));

    await user.click(screen.getByRole('button', { name: '跳过看下一条' }));
    expect((await screen.findAllByText('芳村糖水铺')).length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: '回到视频详情' }));
    expect(await screen.findByText('视频信息')).toBeInTheDocument();
  });

  it('syncs discover detail cards when switching venues', async () => {
    const venueOne = buildVenue({
      id: 'venue-a',
      venueName: '天巢法国餐厅',
      reviewState: 'map_ready',
      latitude: 22.18758,
      longitude: 113.54878,
    });
    const venueTwo = buildVenue({
      id: 'venue-b',
      venueName: '阿文咖喱屋',
      reviewState: 'review',
      geocodeStatus: 'skipped',
      latitude: null,
      longitude: null,
      recommendedDishes: ['咖喱牛腩'],
      flavorTags: ['辛香'],
      addressText: '澳门旧城区小巷',
    });
    const importRecord = buildImport({
      venues: [venueOne, venueTwo],
      commentClues: [
        {
          commentId: 'comment-a',
          authorName: '用户甲',
          message: '新葡京43楼那家法餐就是它。',
          likeCount: 18,
          publishedAt: '2026-04-01T10:00:00.000Z',
          matchedVenueNames: ['天巢法国餐厅'],
          addressHint: '新葡京43楼',
        },
        {
          commentId: 'comment-b',
          authorName: '用户乙',
          message: '阿文咖喱屋在旧城区小巷里。',
          likeCount: 5,
          publishedAt: '2026-04-01T11:00:00.000Z',
          matchedVenueNames: ['阿文咖喱屋'],
          addressHint: '旧城区小巷',
        },
      ],
    });
    apiMocks.loadSnapshot.mockResolvedValue(buildSnapshot([importRecord]));

    render(<App />);

    const user = userEvent.setup();
    await screen.findByText('视频清单');
    expect((await screen.findAllByText('天巢法国餐厅')).length).toBeGreaterThan(0);
    expect(screen.getByText('新葡京43楼那家法餐就是它。')).toBeInTheDocument();

    await user.click(screen.getByTestId('discover-venue-venue-b'));

    await waitFor(() => expect(screen.getAllByText('阿文咖喱屋').length).toBeGreaterThan(0));
    expect(screen.getByText('阿文咖喱屋在旧城区小巷里。')).toBeInTheDocument();
    expect(screen.queryByText('新葡京43楼那家法餐就是它。')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '看单视频地图' })).toBeDisabled();
  });
});
