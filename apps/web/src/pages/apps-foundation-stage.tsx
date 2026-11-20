import { useMemo, useState } from 'react';
import {
  ArrowRight,
  Cpu,
  FolderLock,
  Layers3,
  Play,
} from 'lucide-react';
import type { LandingLocale } from '../landing/i18n/locale.js';
import type { AppOrigin, EcosystemAppEntry } from './app-ecosystem-data.js';

type StageMode = 'shared' | 'legacy';

const FEATURED_APP_IDS: ReadonlyArray<string> = [
  'nimi.zhiyu',
  'nimi.utopia',
  'nimi.parentos',
  'nimiplatform.vane',
  'openmontage.studio',
  'io.github.nimiplatform.next-ai-draw-io',
  'ai.nimi.videolingo',
];

const CONNECTOR_PATHS: ReadonlyArray<{ col: number; d: string }> = [
  { col: 0, d: 'M 50 0 C 50 19, 200 11, 200 32' },
  { col: 1, d: 'M 150 0 C 150 17, 200 13, 200 32' },
  { col: 2, d: 'M 250 0 C 250 17, 200 13, 200 32' },
  { col: 3, d: 'M 350 0 C 350 19, 200 11, 200 32' },
];

const STAGE_COPY: Readonly<Record<LandingLocale, {
  regionLabel: string;
  switchLabel: string;
  modeShared: string;
  modeLegacy: string;
  statusShared: (count: number) => string;
  statusLegacy: string;
  previewAction: string;
  moreAppsLabel: (remaining: number) => string;
  moreAppsHint: string;
  foundationTitle: (count: number) => string;
  foundationPills: readonly [string, string, string];
  sharedFootnote: string;
  legacyHeading: string;
  legacyApps: ReadonlyArray<{
    name: string;
    cost: string;
    friction: string;
  }>;
  legacySummaryTitle: string;
  legacySummaryBody: string;
  backToSharedAction: string;
  originShort: Record<AppOrigin, string>;
}>> = {
  zh: {
    regionLabel: 'Nimi 共享 AI 底座与传统安装方式对比',
    switchLabel: '切换查看运行方式',
    modeShared: 'Nimi 共享底座',
    modeLegacy: '传统单独安装',
    statusShared: (count) => `1 套配置 · ${count} 款软件`,
    statusLegacy: '重复下载 · 各自孤立',
    previewAction: '在线试玩',
    moreAppsLabel: (remaining) => `+${remaining} 款应用`,
    moreAppsHint: '查看全部',
    foundationTitle: (count) => `${count} 款软件共用一套本机 AI 底座`,
    foundationPills: ['本地显卡 / 云服务', '各软件独立文件夹', '零重复填密钥'],
    sharedFootnote: '点选上方图标切换查看，点击「在线试玩」可直接在网页体验。',
    legacyHeading: '每装一款 AI 软件，都要重复走一遍环境与密钥配置',
    legacyApps: [
      { name: '对话工具', cost: '+4 GB 运行环境', friction: '重填 API Key' },
      { name: '研究助手', cost: '+4 GB 运行环境', friction: '重配本地模型' },
      { name: '视频工具', cost: '+4 GB 运行环境', friction: '重复装依赖' },
      { name: '绘图工具', cost: '+4 GB 运行环境', friction: '数据彼此孤立' },
    ],
    legacySummaryTitle: '硬盘塞满重复环境，换一款工具就得重新折腾',
    legacySummaryBody: '每个软件各自捆绑大模型运行时与密钥配置，启动慢、占用高。',
    backToSharedAction: '查看 Nimi 方案',
    originShort: {
      'nimi-official': 'Nimi 原生',
      'open-source-adapted': '开源适配',
    },
  },
  en: {
    regionLabel: 'Shared Nimi AI Foundation vs Separate App Installs',
    switchLabel: 'Switch architecture view',
    modeShared: 'Nimi Shared Foundation',
    modeLegacy: 'Separate Installs',
    statusShared: (count) => `1 setup · ${count} apps`,
    statusLegacy: 'Duplicated · Isolated',
    previewAction: 'Try preview',
    moreAppsLabel: (remaining) => `+${remaining} more`,
    moreAppsHint: 'Browse all',
    foundationTitle: (count) => `${count} Apps Sharing One Local AI Foundation`,
    foundationPills: ['Local GPU & Cloud', 'Isolated App Folders', 'No Repeated Keys'],
    sharedFootnote: 'Select any app above to inspect, or launch an interactive preview right here.',
    legacyHeading: 'Every standalone AI app duplicates runtimes and key setup',
    legacyApps: [
      { name: 'Chat Tool', cost: '+4 GB runtime', friction: 'Re-paste keys' },
      { name: 'Research App', cost: '+4 GB runtime', friction: 'Separate models' },
      { name: 'Video Tool', cost: '+4 GB runtime', friction: 'Duplicate deps' },
      { name: 'Diagram Tool', cost: '+4 GB runtime', friction: 'Isolated setup' },
    ],
    legacySummaryTitle: 'Disks fill up with duplicate stacks every time you try a new tool',
    legacySummaryBody: 'Each app bundles its own model runtime and credentials, slowing launch and upkeep.',
    backToSharedAction: 'See Nimi setup',
    originShort: {
      'nimi-official': 'Nimi Native',
      'open-source-adapted': 'Open-Source Adapted',
    },
  },
};

export function AppsFoundationStage({
  locale,
  apps,
  onOpenPreview,
}: {
  locale: LandingLocale;
  apps: ReadonlyArray<EcosystemAppEntry>;
  onOpenPreview: (appId: string) => void;
}) {
  const copy = STAGE_COPY[locale];
  const [mode, setMode] = useState<StageMode>('shared');

  const featuredApps = useMemo(() => {
    const byId = new Map(apps.map((app) => [app.id, app]));
    const picked = FEATURED_APP_IDS
      .map((id) => byId.get(id))
      .filter((app): app is EcosystemAppEntry => Boolean(app));
    return picked.length > 0 ? picked : apps.slice(0, 7);
  }, [apps]);

  const [selectedId, setSelectedId] = useState<string>(featuredApps[0]?.id ?? '');

  const activeIndex = Math.max(
    0,
    featuredApps.findIndex((app) => app.id === selectedId),
  );
  const activeApp = featuredApps[activeIndex] ?? featuredApps[0];
  const activeCol = activeIndex % 4;
  const remainingCount = Math.max(0, apps.length - featuredApps.length);

  return (
    <div
      className="public-apps-foundation-stage"
      data-mode={mode}
      role="region"
      aria-label={copy.regionLabel}
    >
      <div className="public-apps-stage-header">
        <div className="public-apps-stage-switch" role="group" aria-label={copy.switchLabel}>
          <button
            type="button"
            aria-pressed={mode === 'shared'}
            className={mode === 'shared' ? 'is-active' : undefined}
            onClick={() => setMode('shared')}
          >
            {copy.modeShared}
          </button>
          <button
            type="button"
            aria-pressed={mode === 'legacy'}
            className={mode === 'legacy' ? 'is-active' : undefined}
            onClick={() => setMode('legacy')}
          >
            {copy.modeLegacy}
          </button>
        </div>
        <span className="public-apps-stage-status" data-mode={mode}>
          <i aria-hidden="true" />
          <span>{mode === 'shared' ? copy.statusShared(apps.length) : copy.statusLegacy}</span>
        </span>
      </div>

      {mode === 'shared' && activeApp ? (
        <div className="public-apps-stage-body is-shared">
          <div className="public-apps-stage-spotlight">
            <div className="public-apps-stage-spotlight-main">
              {activeApp.iconSrc ? (
                <img
                  src={activeApp.iconSrc}
                  alt=""
                  width={42}
                  height={42}
                  className="public-apps-stage-spotlight-icon"
                />
              ) : null}
              <div className="public-apps-stage-spotlight-copy">
                <div className="public-apps-stage-spotlight-title-row">
                  <strong>{activeApp.name}</strong>
                  <span className="public-apps-stage-origin-chip" data-origin={activeApp.origin}>
                    {copy.originShort[activeApp.origin]}
                  </span>
                </div>
                <p>{activeApp.description}</p>
              </div>
            </div>
            <button
              type="button"
              className="public-apps-stage-preview-btn"
              onClick={() => onOpenPreview(activeApp.id)}
              aria-label={`${copy.previewAction} · ${activeApp.name}`}
            >
              <Play size={12} aria-hidden="true" />
              <span>{copy.previewAction}</span>
            </button>
          </div>

          <div className="public-apps-stage-dock" role="group" aria-label={copy.modeShared}>
            {featuredApps.map((app) => {
              const isSelected = app.id === activeApp.id;
              return (
                <button
                  key={app.id}
                  type="button"
                  aria-pressed={isSelected}
                  className={`public-apps-stage-tile${isSelected ? ' is-selected' : ''}`}
                  onClick={() => setSelectedId(app.id)}
                  onMouseEnter={() => setSelectedId(app.id)}
                >
                  {app.iconSrc ? (
                    <img src={app.iconSrc} alt="" width={34} height={34} loading="eager" decoding="async" />
                  ) : null}
                  <span>{app.name}</span>
                </button>
              );
            })}

            <a href="#apps-catalog" className="public-apps-stage-tile is-more">
              <span className="public-apps-stage-more-badge" aria-hidden="true">
                +{remainingCount}
              </span>
              <span>{copy.moreAppsHint}</span>
              <span className="sr-only">{copy.moreAppsLabel(remainingCount)}</span>
            </a>
          </div>

          <div className="public-apps-stage-bus" aria-hidden="true">
            <svg viewBox="0 0 400 32" preserveAspectRatio="none">
              {CONNECTOR_PATHS.map(({ col, d }) => (
                <path
                  key={col}
                  d={d}
                  className={col === activeCol ? 'is-active' : undefined}
                />
              ))}
            </svg>
            <span className="public-apps-stage-bus-hub" />
          </div>

          <div className="public-apps-stage-foundation">
            <div className="public-apps-stage-foundation-head">
              <span className="public-apps-stage-foundation-logo" aria-hidden="true">
                <img src="/logo.svg" alt="" width={18} height={18} />
              </span>
              <strong className="public-apps-stage-foundation-title">
                {copy.foundationTitle(apps.length)}
              </strong>
            </div>

            <ul className="public-apps-stage-foundation-pills">
              <li>
                <Cpu size={13} aria-hidden="true" />
                <span>{copy.foundationPills[0]}</span>
              </li>
              <li>
                <FolderLock size={13} aria-hidden="true" />
                <span>{copy.foundationPills[1]}</span>
              </li>
              <li>
                <Layers3 size={13} aria-hidden="true" />
                <span>{copy.foundationPills[2]}</span>
              </li>
            </ul>
          </div>

          <p className="public-apps-stage-footnote">{copy.sharedFootnote}</p>
        </div>
      ) : (
        <div className="public-apps-stage-body is-legacy">
          <p className="public-apps-stage-legacy-heading">{copy.legacyHeading}</p>

          <div className="public-apps-stage-legacy-grid">
            {copy.legacyApps.map((item) => (
              <div key={item.name} className="public-apps-stage-legacy-card">
                <strong>{item.name}</strong>
                <div className="public-apps-stage-legacy-tags">
                  <span>{item.cost}</span>
                  <span>{item.friction}</span>
                </div>
              </div>
            ))}
          </div>

          <div className="public-apps-stage-legacy-footer">
            <div className="public-apps-stage-legacy-summary">
              <strong>{copy.legacySummaryTitle}</strong>
              <p>{copy.legacySummaryBody}</p>
            </div>
            <button
              type="button"
              className="public-apps-stage-back-btn"
              onClick={() => setMode('shared')}
            >
              <span>{copy.backToSharedAction}</span>
              <ArrowRight size={13} aria-hidden="true" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
