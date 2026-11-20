import { getHeroDemoAppItems } from '../landing/content/core-hero-demo.js';
import type { HeroDemoAppItem } from '../landing/content/landing-content.js';
import type { LandingLocale } from '../landing/i18n/locale.js';
import { APP_CATALOG, type CatalogApp } from './informational-content.js';

// @nimi-authority: rule.nimi.platform.product-lifecycle.p-web-005e
export type AppOrigin = 'nimi-official' | 'open-source-adapted';

export type AppAvailabilityPosture =
  | 'catalog-admitted'
  | 'first-party-companion'
  | 'interactive-preview';

export type EcosystemAppEntry = {
  readonly id: string;
  readonly name: string;
  readonly iconSrc?: string;
  readonly previewImageSrc: string;
  readonly description: string;
  readonly tags: ReadonlyArray<string>;
  readonly origin: AppOrigin;
  readonly posture: AppAvailabilityPosture;
  readonly catalog?: CatalogApp;
};

const NIMI_OFFICIAL_APP_IDS = new Set<string>([
  'nimi.zhiyu',
  'nimi.utopia',
  'nimi.parentos',
  'nimi.overtone',
  'nimi.storybook',
  'nimi.realm-persona-studio',
  'nimi.shijing',
  'nimi.inscape',
  'nimi.realm-world-studio',
  'nimi.odd-bureau',
  'nimi.polyagent',
]);

const CATALOG_BY_ID = new Map<string, CatalogApp>(
  APP_CATALOG.map((entry) => [entry.id, entry]),
);

export const INITIAL_VISIBLE_APP_COUNT = 6;

const ECOSYSTEM_ORDER: ReadonlyArray<string> = [
  // Curated initial 6 (balanced 3 Nimi official + 3 open-source adapted across core use cases)
  'nimi.zhiyu',
  'nimi.utopia',
  'nimi.parentos',
  'nimiplatform.vane',
  'openmontage.studio',
  'io.github.nimiplatform.next-ai-draw-io',
  // Remaining open-source adaptations & Nimi official apps
  'nimi.overtone',
  'org.nimiplatform.sillytavern',
  'ai.nimi.videolingo',
  'nimi.storybook',
  'org.nimiplatform.deeptutor',
  'io.github.nimiplatform.open-notebook',
  'io.github.nimiplatform.presenton',
  'nimi.realm-persona-studio',
  'nimi.realm-world-studio',
  'nimi.shijing',
  'nimi.inscape',
  'nimi.odd-bureau',
  'nimi.polyagent',
  'ai.nimi.openwhispr',
  'moneyprinterturbo.studio',
  'nimiplatform.voicestudio',
  'io.github.nimiplatform.jev-search',
  'io.github.nimiplatform.jev-ultrafast',
];

export function resolveAppOrigin(appId: string): AppOrigin {
  return NIMI_OFFICIAL_APP_IDS.has(appId) ? 'nimi-official' : 'open-source-adapted';
}

export function getEcosystemApps(locale: LandingLocale): ReadonlyArray<EcosystemAppEntry> {
  const demoItems = getHeroDemoAppItems(locale);
  const demoById = new Map<string, HeroDemoAppItem>(
    demoItems.map((item) => [item.id, item]),
  );

  const orderedIds = [
    ...ECOSYSTEM_ORDER.filter((id) => demoById.has(id)),
    ...demoItems.map((item) => item.id).filter((id) => !ECOSYSTEM_ORDER.includes(id)),
  ];

  return orderedIds.map((id) => {
    const demoItem = demoById.get(id)!;
    const catalog = CATALOG_BY_ID.get(id);
    const origin = resolveAppOrigin(id);
    const posture: AppAvailabilityPosture = id === 'nimi.zhiyu'
      ? 'first-party-companion'
      : catalog
        ? 'catalog-admitted'
        : 'interactive-preview';

    return {
      id,
      name: demoItem.name,
      iconSrc: demoItem.iconSrc,
      previewImageSrc: `/story/app-previews/${locale}/${id}.webp`,
      description: catalog?.summary?.[locale] ?? demoItem.task,
      tags: demoItem.tags,
      origin,
      posture,
      catalog,
    };
  });
}

export type EcosystemFilterId = 'all' | 'nimi-official' | 'open-source-adapted';

export const APP_ECOSYSTEM_COPY: Readonly<Record<LandingLocale, {
  eyebrow: string;
  heroAvailability: string;
  provenanceCalloutTitle: string;
  provenanceCalloutOfficial: string;
  provenanceCalloutAdapted: string;
  availabilityBreakdownLabel: string;
  availabilityBreakdown: ReadonlyArray<{
    posture: AppAvailabilityPosture;
    title: string;
    body: string;
  }>;
  availabilityLabel: string;
  filterLabel: string;
  filters: Record<EcosystemFilterId, string>;
  originBadge: Record<AppOrigin, string>;
  originShortLabel: Record<AppOrigin, string>;
  originDetail: Record<AppOrigin, string>;
  postureBadge: Record<AppAvailabilityPosture, string>;
  postureDetail: Record<AppAvailabilityPosture, string>;
  windowsOnlyBadge: string;
  previewPlatformsValue: string;
  licenseBundledNote: string;
  licensePreviewNote: string;
  previewSourceNote: string;
  previewAction: string;
  detailAction: string;
  platformsSummary: string;
  previewFootnote: string;
  searchPlaceholder: string;
  searchAriaLabel: string;
  clearSearch: string;
  provenanceToggleLabel: string;
  expandAllAction: string;
  collapseAction: string;
  emptySearchTitle: string;
  emptySearchBody: string;
  resetFiltersAction: string;
}>> = {
  zh: {
    eyebrow: '24 款精选好工具 · 在线试玩',
    heroAvailability: '打开应用介绍，查看可用的 Web 或 PC 版本。PC 版可在 Nimi Home 的应用目录安装。',
    provenanceCalloutTitle: '应用从哪来、怎么装',
    provenanceCalloutOfficial: 'Nimi 团队原生打造，涵盖陪伴聊天、洞天栖居画卷、音乐故事创作与家庭成长记录。',
    provenanceCalloutAdapted: '精选社区热门开源工具（如 Vane、SillyTavern、VideoLingo 等），适配后直接共用你的 Nimi 算力，不用再单独配环境。',
    availabilityBreakdownLabel: '当前应用的获取方式',
    availabilityBreakdown: [
      {
        posture: 'first-party-companion',
        title: '随桌面端内置',
        body: '当前产品构建随附织羽，并随 Nimi 更新。公开 Beta v0.2.4 早于这项变更。',
      },
      {
        posture: 'catalog-admitted',
        title: '桌面目录已上架',
        body: '打开 Nimi Home 的「应用」页即可一键查看并安装。',
      },
      {
        posture: 'interactive-preview',
        title: '交互预览 · 开发者预览',
        body: '可在官网在线试玩，桌面端当前面向本地开发模式开放。',
      },
    ],
    availabilityLabel: '当前获取方式',
    filterLabel: '按应用来源筛选',
    filters: {
      all: '全部',
      'nimi-official': 'Nimi 原生',
      'open-source-adapted': '开源适配',
    },
    originBadge: {
      'nimi-official': 'Nimi 官方',
      'open-source-adapted': '开源项目 · Nimi 适配',
    },
    originShortLabel: {
      'nimi-official': 'Nimi 原生',
      'open-source-adapted': '开源适配',
    },
    originDetail: {
      'nimi-official': 'Nimi 官方研发并维护的原生应用。',
      'open-source-adapted': '源于社区开源项目，由 Nimi 完成 Fork 并适配 Nimi Runtime。',
    },
    postureBadge: {
      'catalog-admitted': '桌面目录已上架',
      'first-party-companion': '随桌面端内置',
      'interactive-preview': '交互预览 · 开发者预览',
    },
    postureDetail: {
      'first-party-companion': '织羽已加入 macOS arm64 和 Windows x86_64 的产品构建，随 Nimi 安装和更新。公开 Beta v0.2.4 尚未随附织羽。',
      'catalog-admitted': '已有版本获准进入 Nimi 桌面目录。请在 Nimi Home 中查看当前可安装的版本及要求。',
      'interactive-preview': '可在浏览器中直接体验交互预览；桌面端当前通过 Nimi Home 开发者模式运行，尚未上架普通应用目录。',
    },
    windowsOnlyBadge: '仅 Windows',
    previewPlatformsValue: '浏览器交互预览 · 本地开发模式',
    licenseBundledNote: 'MIT（随 Nimi 发行）',
    licensePreviewNote: '遵循上游仓库与平台开源许可',
    previewSourceNote: 'github.com/nimiplatform（开源适配与演示）',
    previewAction: '交互预览',
    detailAction: '了解应用',
    platformsSummary: '桌面端：macOS arm64 · Windows x86_64（部分仅限 Windows）',
    previewFootnote: '带有“交互预览”的应用可以先体验界面。已发布 Web 版的应用在介绍页提供运行入口。',
    searchPlaceholder: '搜索应用名称、用途或能力…',
    searchAriaLabel: '搜索应用',
    clearSearch: '清除搜索',
    provenanceToggleLabel: '来源与获取说明',
    expandAllAction: '展开全部 {total} 款应用',
    collapseAction: '收起为精选 {count} 款',
    emptySearchTitle: '没有找到匹配的应用',
    emptySearchBody: '试试换个关键词，或重置筛选查看全部应用。',
    resetFiltersAction: '查看全部应用',
  },
  en: {
    eyebrow: '24 Curated Apps · Live Previews',
    heroAvailability: 'Open an app’s details to see available Web and desktop versions. Install desktop versions from the Nimi Home catalog.',
    provenanceCalloutTitle: 'Where apps come from & how to get them',
    provenanceCalloutOfficial: 'Crafted by Nimi for companion chat, living habitat scrolls, creative studios, and everyday life journals.',
    provenanceCalloutAdapted: 'Beloved community open-source tools (Vane, SillyTavern, VideoLingo, and more) adapted to share your single Nimi AI setup.',
    availabilityBreakdownLabel: 'How to get these apps',
    availabilityBreakdown: [
      {
        posture: 'first-party-companion',
        title: 'Bundled in Desktop',
        body: 'Current product builds bundle Zhiyu and update it with Nimi. The public v0.2.4 Beta predates this change.',
      },
      {
        posture: 'catalog-admitted',
        title: 'In Desktop Catalog',
        body: 'Open the Apps tab inside Nimi Home to browse and install.',
      },
      {
        posture: 'interactive-preview',
        title: 'Interactive Preview · Dev Preview',
        body: 'Try the interactive preview in your browser; available on desktop via local developer mode.',
      },
    ],
    availabilityLabel: 'Current availability',
    filterLabel: 'Filter apps by source',
    filters: {
      all: 'All',
      'nimi-official': 'Nimi Official',
      'open-source-adapted': 'Open-Source',
    },
    originBadge: {
      'nimi-official': 'Nimi Official',
      'open-source-adapted': 'Open-Source · Nimi Adapted',
    },
    originShortLabel: {
      'nimi-official': 'Nimi Official',
      'open-source-adapted': 'Open-Source',
    },
    originDetail: {
      'nimi-official': 'First-party application designed and maintained by Nimi.',
      'open-source-adapted': 'Third-party open-source project forked and adapted by Nimi for the Nimi Runtime.',
    },
    postureBadge: {
      'catalog-admitted': 'In Desktop Catalog',
      'first-party-companion': 'Bundled in Desktop',
      'interactive-preview': 'Interactive Preview · Dev Preview',
    },
    postureDetail: {
      'first-party-companion': 'Current macOS arm64 and Windows x86_64 product builds install and update Zhiyu with Nimi. The public v0.2.4 Beta predates the bundled app.',
      'catalog-admitted': 'Versions have been admitted to the Nimi Desktop App Catalog. Check Nimi Home for current install options and requirements.',
      'interactive-preview': 'Try the interactive preview directly in your browser; currently runs on desktop via Nimi Home Developer Mode rather than the general App Catalog.',
    },
    windowsOnlyBadge: 'Windows only',
    previewPlatformsValue: 'Browser interactive preview · Local developer mode',
    licenseBundledNote: 'MIT (bundled with Nimi)',
    licensePreviewNote: 'Subject to the upstream and repository open-source licenses',
    previewSourceNote: 'github.com/nimiplatform (adaptations & previews)',
    previewAction: 'Interactive preview',
    detailAction: 'View app',
    platformsSummary: 'Desktop: macOS arm64 · Windows x86_64 (some Windows-only)',
    previewFootnote: 'Apps with an interactive preview let you explore their interface. Open an app’s introduction to launch its published Web version.',
    searchPlaceholder: 'Search apps, tasks, or capabilities…',
    searchAriaLabel: 'Search apps',
    clearSearch: 'Clear search',
    provenanceToggleLabel: 'Sources & install guide',
    expandAllAction: 'Show all {total} apps',
    collapseAction: 'Show featured {count}',
    emptySearchTitle: 'No matching apps',
    emptySearchBody: 'Try another keyword or reset filters to browse all apps.',
    resetFiltersAction: 'Show all apps',
  },
};
