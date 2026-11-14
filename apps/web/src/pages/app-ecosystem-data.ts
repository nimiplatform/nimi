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

const ECOSYSTEM_ORDER: ReadonlyArray<string> = [
  // First-party companion and Nimi apps
  'nimi.zhiyu',
  'nimi.parentos',
  'nimi.overtone',
  'nimi.storybook',
  'nimi.realm-persona-studio',
  'nimi.realm-world-studio',
  'nimi.shijing',
  'nimi.inscape',
  'nimi.odd-bureau',
  'nimi.polyagent',
  // Open-source adaptations
  'nimiplatform.vane',
  'openmontage.studio',
  'io.github.nimiplatform.next-ai-draw-io',
  'org.nimiplatform.sillytavern',
  'ai.nimi.videolingo',
  'org.nimiplatform.deeptutor',
  'io.github.nimiplatform.open-notebook',
  'io.github.nimiplatform.presenton',
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

export type EcosystemFilterId = 'all' | 'nimi-official' | 'open-source-adapted' | 'catalog-admitted';

export const APP_ECOSYSTEM_COPY: Readonly<Record<LandingLocale, {
  eyebrow: string;
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
  originDetail: Record<AppOrigin, string>;
  postureBadge: Record<AppAvailabilityPosture, string>;
  postureDetail: Record<AppAvailabilityPosture, string>;
  previewPlatformsValue: string;
  licenseBundledNote: string;
  licensePreviewNote: string;
  previewSourceNote: string;
  previewAction: string;
  detailAction: string;
  platformsSummary: string;
  previewFootnote: string;
}>> = {
  zh: {
    eyebrow: '应用生态 · 官方原生与开源适配',
    provenanceCalloutTitle: '两类来源，同一套个人 AI 底座',
    provenanceCalloutOfficial: 'Nimi 官方原生：由 Nimi 团队面向个人陪伴、创作与生活记录原生设计并发布。',
    provenanceCalloutAdapted: '开源项目 · Nimi 适配：本为优秀的第三方开源项目（如 Vane、SillyTavern、OpenMontage 等），由 Nimi 完成 Fork 与底座适配，使其无需各自捆绑模型环境或重复填写 API Key 即可直接调用 Nimi 算力。',
    availabilityBreakdownLabel: '当前应用的获取方式',
    availabilityBreakdown: [
      {
        posture: 'first-party-companion',
        title: '随桌面端内置',
        body: '织羽（Zhiyu）随 Nimi 桌面安装包内置提供，安装后直接可用。',
      },
      {
        posture: 'catalog-admitted',
        title: '桌面目录已上架',
        body: '在 Nimi Home 的应用目录中查看适用于你设备的版本。各应用的准入平台见详情。',
      },
      {
        posture: 'interactive-preview',
        title: '交互预览 · 开发者适配',
        body: '可在官网体验示例工作流。',
      },
    ],
    availabilityLabel: '当前获取方式',
    filterLabel: '按来源与准入状态筛选',
    filters: {
      all: '全部应用',
      'nimi-official': 'Nimi 官方原生',
      'open-source-adapted': '开源项目 · Nimi 适配',
      'catalog-admitted': '桌面目录已上架',
    },
    originBadge: {
      'nimi-official': 'Nimi 官方',
      'open-source-adapted': '开源项目 · Nimi 适配',
    },
    originDetail: {
      'nimi-official': 'Nimi 官方研发并维护的原生应用。',
      'open-source-adapted': '源于社区开源项目，由 Nimi 完成 Fork 与 Runtime 能力底座适配。',
    },
    postureBadge: {
      'catalog-admitted': '桌面目录已上架',
      'first-party-companion': '随桌面端内置',
      'interactive-preview': '交互预览 · 开发者适配',
    },
    postureDetail: {
      'first-party-companion': '随 Nimi 桌面客户端安装包（macOS arm64 · Windows x86_64）内置提供，随主程序同步安装与更新；无需在应用目录中单独下载。',
      'catalog-admitted': '已有版本获准进入 Nimi 桌面目录。请在 Nimi Home 中查看当前可安装的版本及要求。',
      'interactive-preview': '可在浏览器中体验示例工作流。',
    },
    previewPlatformsValue: '浏览器交互预览 · 本地开发模式',
    licenseBundledNote: 'MIT（随 Nimi 发行）',
    licensePreviewNote: '遵循上游仓库与平台开源许可',
    previewSourceNote: 'github.com/nimiplatform（开源适配与演示）',
    previewAction: '交互预览',
    detailAction: '了解应用',
    platformsSummary: '桌面端支持：macOS arm64 · Windows x86_64',
    previewFootnote: '点击任意卡片的“交互预览”即可在浏览器中体验界面流程；实际桌面应用管理在 Nimi 客户端中完成。',
  },
  en: {
    eyebrow: 'App Ecosystem · First-Party & Open-Source Adaptations',
    provenanceCalloutTitle: 'Two origins, one personal AI foundation',
    provenanceCalloutOfficial: 'Nimi Official: Built and published natively by Nimi for companion continuity, creative studios, and personal records.',
    provenanceCalloutAdapted: 'Open-Source · Nimi Adapted: Established third-party open-source projects (such as Vane, SillyTavern, and OpenMontage) forked and adapted by Nimi so they consume your unified Nimi Runtime without bundling duplicate model stacks or per-app API keys.',
    availabilityBreakdownLabel: 'How to get these apps',
    availabilityBreakdown: [
      {
        posture: 'first-party-companion',
        title: 'Bundled in Desktop',
        body: 'Zhiyu ships directly inside the Nimi Desktop installer and updates alongside Nimi.',
      },
      {
        posture: 'catalog-admitted',
        title: 'In Desktop Catalog',
        body: 'Check the Nimi Home catalog for a version for your device. See each app’s details for admitted platforms.',
      },
      {
        posture: 'interactive-preview',
        title: 'Interactive Preview · Dev Adaptation',
        body: 'Explore sample workflows in your browser.',
      },
    ],
    availabilityLabel: 'Current availability',
    filterLabel: 'Filter by provenance and catalog status',
    filters: {
      all: 'All apps',
      'nimi-official': 'Nimi Official',
      'open-source-adapted': 'Open-Source · Nimi Adapted',
      'catalog-admitted': 'In Desktop Catalog',
    },
    originBadge: {
      'nimi-official': 'Nimi Official',
      'open-source-adapted': 'Open-Source · Nimi Adapted',
    },
    originDetail: {
      'nimi-official': 'First-party application designed and maintained by Nimi.',
      'open-source-adapted': 'Third-party open-source project forked and adapted by Nimi onto the Nimi Runtime.',
    },
    postureBadge: {
      'catalog-admitted': 'In Desktop Catalog',
      'first-party-companion': 'Bundled in Desktop',
      'interactive-preview': 'Interactive Preview · Dev Adaptation',
    },
    postureDetail: {
      'first-party-companion': 'Bundled directly in the Nimi Desktop installer (macOS arm64 · Windows x86_64) and updated alongside Nimi; no separate catalog install needed.',
      'catalog-admitted': 'Versions have been admitted to the Nimi Desktop App Catalog. Check Nimi Home for current install options and requirements.',
      'interactive-preview': 'Explore a sample workflow in the browser.',
    },
    previewPlatformsValue: 'Browser interactive preview · Local developer mode',
    licenseBundledNote: 'MIT (bundled with Nimi)',
    licensePreviewNote: 'Governed by upstream & repository open-source license',
    previewSourceNote: 'github.com/nimiplatform (adaptations & previews)',
    previewAction: 'Interactive preview',
    detailAction: 'View app',
    platformsSummary: 'Desktop support: macOS arm64 · Windows x86_64',
    previewFootnote: 'Select “Interactive preview” on any card to explore its workflow in your browser; actual desktop app management happens inside Nimi.',
  },
};
