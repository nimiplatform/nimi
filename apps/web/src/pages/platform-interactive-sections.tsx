import {
  ArrowRight,
  BrainCircuit,
  Check,
  Cpu,
  FolderLock,
  Globe,
  Laptop,
  Lock,
  Radio,
  ShieldCheck,
  Smartphone,
  WifiOff,
  X,
  Zap,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { withLocaleQuery } from '../landing/config/landing-links.js';
import type { LandingLocale } from '../landing/i18n/locale.js';
import type { CapabilityId } from './platform-capability-samples.js';

const DOMAIN_ICONS = { runtime: Cpu, cognition: BrainCircuit, realm: Globe } as const;
const STAGE_ICONS = { desktop: Laptop, remote: Smartphone, roadmap: Radio } as const;

export type DomainId = keyof typeof DOMAIN_ICONS;
export type StageId = keyof typeof STAGE_ICONS;

/* -------------------------------------------------------------------------- */
/* Chapter 01: Live Runtime Contract Router Strip (Light-Porcelain Harmonized)*/
/* -------------------------------------------------------------------------- */

const ROUTER_UI = {
  zh: {
    appCall: '上层应用标准调用',
    routerTitle: 'Nimi Runtime 契约路由',
    routerSub: '屏蔽底层模型差异 · 零品牌硬编码',
    planeLocal: '本机推理平面',
    planeLocalBadge: '严格锁定本机 · 零静默云回退',
    planeCloud: '云端连接平面',
    planeCloudBadge: '仅按当次请求透明计费',
    engineSingular: '项引擎',
    enginesUnit: '项引擎',
    connectorSingular: '项连接',
    connectorsUnit: '项连接',
  },
  en: {
    appCall: 'App Capability Call',
    routerTitle: 'Nimi Runtime Router',
    routerSub: 'Vendor-neutral contract layer',
    planeLocal: 'Local Execution Plane',
    planeLocalBadge: 'Locked to machine · Zero silent fallback',
    planeCloud: 'Cloud Connector Plane',
    planeCloudBadge: 'Per-request transparent routing',
    engineSingular: 'engine',
    enginesUnit: 'engines',
    connectorSingular: 'connector',
    connectorsUnit: 'connectors',
  },
} as const;

export function PlatformLiveRouterStrip({
  locale,
  capability,
  localCount,
  remoteCount,
  principles,
}: {
  locale: LandingLocale;
  capability: CapabilityId;
  localCount: number;
  remoteCount: number;
  principles: ReadonlyArray<string>;
}) {
  const ui = ROUTER_UI[locale];

  return (
    <div className="platform-router-console">
      <div className="platform-router-pipeline">
        {/* Left: App Request Node */}
        <div className="platform-router-node is-caller">
          <small>{ui.appCall}</small>
          <code>{capability}()</code>
        </div>

        {/* Animated Conduit 1 */}
        <div className="platform-router-wire" aria-hidden="true">
          <span className="platform-wire-packet" />
        </div>

        {/* Center: Luminous Nimi Runtime Kernel Router */}
        <div className="platform-router-node is-kernel">
          <div className="platform-router-kernel-top">
            <img src="/logo.svg" alt="" width={16} height={16} />
            <strong>{ui.routerTitle}</strong>
          </div>
          <small>{ui.routerSub}</small>
        </div>

        {/* Animated Conduit 2 */}
        <div className="platform-router-wire" aria-hidden="true">
          <span className="platform-wire-packet is-delayed" />
        </div>

        {/* Right: Dual Execution Planes (Simultaneously Visible, Zero Tab Hiding) */}
        <div className="platform-router-planes">
          <div className="platform-plane-card is-local">
            <div className="platform-plane-btn-head">
              <Laptop size={14} aria-hidden="true" />
              <strong>{ui.planeLocal}</strong>
              <code>{localCount} {localCount === 1 ? ui.engineSingular : ui.enginesUnit}</code>
            </div>
            <small><Lock size={11} aria-hidden="true" />{ui.planeLocalBadge}</small>
          </div>

          <div className="platform-plane-card is-cloud">
            <div className="platform-plane-btn-head">
              <Globe size={14} aria-hidden="true" />
              <strong>{ui.planeCloud}</strong>
              <code>{remoteCount} {remoteCount === 1 ? ui.connectorSingular : ui.connectorsUnit}</code>
            </div>
            <small><Zap size={11} aria-hidden="true" />{ui.planeCloudBadge}</small>
          </div>
        </div>
      </div>

      <div className="platform-principles-bar">
        {principles.map((principle) => (
          <span key={principle} className="platform-principle-pill">
            <Check size={14} aria-hidden="true" />
            <span>{principle}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Chapter 02: Simultaneous Tri-Domain Signal Lifeline & Firewall Schematic   */
/* -------------------------------------------------------------------------- */

const DOMAIN_FLOW_UI = {
  zh: {
    simLabel: '三域协同流转与物理隔离全景图',
    lanes: [
      {
        id: 'runtime' as DomainId,
        step: '01 · 执行入口',
        allow: '能力契约校验放行',
        block: '原始 API 密钥零外泄',
      },
      {
        id: 'cognition' as DomainId,
        step: '02 · 记忆沉淀',
        allow: '溯源上下文写入本机',
        block: '未授权应用物理分区隔离',
      },
      {
        id: 'realm' as DomainId,
        step: '03 · 跨端互联',
        allow: '唯一身份与世界原语同步',
        block: '本机模型与私聊零上云',
      },
    ],
  },
  en: {
    simLabel: 'Simultaneous three-domain signal flow and hard isolation',
    lanes: [
      {
        id: 'runtime' as DomainId,
        step: '01 · Execution',
        allow: 'Declared capabilities routed',
        block: 'Raw API secrets never exposed',
      },
      {
        id: 'cognition' as DomainId,
        step: '02 · Local Memory',
        allow: 'Provenance-tagged context saved',
        block: 'Unauthorized apps partitioned',
      },
      {
        id: 'realm' as DomainId,
        step: '03 · Identity & Lore',
        allow: 'Identity & shared worlds synced',
        block: 'Private chats & models stay local',
      },
    ],
  },
} as const;

export function PlatformDomainsSection({
  locale,
  domains,
  ownsLabel,
  boundaryLabel,
}: {
  locale: LandingLocale;
  domains: ReadonlyArray<{
    id: DomainId;
    badge: string;
    title: string;
    summary: string;
    owns: string;
    boundary: string;
  }>;
  ownsLabel: string;
  boundaryLabel: string;
}) {
  const ui = DOMAIN_FLOW_UI[locale];

  return (
    <div className="platform-domains-interactive">
      {/* Unified Tab-Free Tri-Domain Signal & Firewall Schematic */}
      <div className="platform-domain-sim-panel" role="region" aria-label={ui.simLabel}>
        <div className="platform-domain-lanes">
          {ui.lanes.map((lane) => (
            <div key={lane.id} className="platform-domain-lane-cell">
              <span className="platform-lane-step">{lane.step}</span>
              <div className="platform-lane-pill is-allow">
                <Check size={12} aria-hidden="true" />
                <span>{lane.allow}</span>
              </div>
              <div className="platform-lane-pill is-block">
                <X size={12} aria-hidden="true" />
                <span>{lane.block}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Continuous Animated SVG Lifeline Connecting All 3 Domains Simultaneously */}
        <svg className="platform-domain-bus-svg" viewBox="0 0 1000 44" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id="nimi-domain-grad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#05DC78" />
              <stop offset="50%" stopColor="#11BCE2" />
              <stop offset="100%" stopColor="#1476D4" />
            </linearGradient>
          </defs>
          <line x1="166" y1="16" x2="834" y2="16" className="platform-domain-backbone" />
          <line x1="166" y1="16" x2="834" y2="16" stroke="url(#nimi-domain-grad)" className="platform-domain-stream" />
          {[166, 500, 834].map((cx) => (
            <g key={cx}>
              <line x1={cx} y1="16" x2={cx} y2="44" className="platform-domain-drop is-active" />
              <circle cx={cx} cy="16" r="4.5" className="platform-domain-focus-node" />
              {/* Subtle red boundary shield tick */}
              <rect x={cx + 24} y="26" width="22" height="4" rx="2" className="platform-domain-shield-bar" />
            </g>
          ))}
        </svg>
      </div>

      {/* Synchronized 3-Domain Cards */}
      <div className="public-domain-grid public-platform-domain-list">
        {domains.map((domain) => {
          const Icon = DOMAIN_ICONS[domain.id];
          return (
            <article
              key={domain.id}
              className="public-domain-card platform-domain-card-live"
              data-domain={domain.id}
            >
              <div className="public-domain-card-top">
                <span className="story-pillar-icon" aria-hidden="true">
                  <Icon size={20} />
                </span>
                <span className="public-domain-badge">{domain.badge}</span>
              </div>
              <h3>{domain.title}</h3>
              <p className="public-domain-summary">{domain.summary}</p>
              <dl className="public-domain-points">
                <div className="is-lit-allow">
                  <dt>{ownsLabel}</dt>
                  <dd>{domain.owns}</dd>
                </div>
                <div className="is-lit-block">
                  <dt>{boundaryLabel}</dt>
                  <dd>{domain.boundary}</dd>
                </div>
              </dl>
            </article>
          );
        })}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Chapter 03: Simultaneous Spatial Viewport Projection Continuum             */
/* -------------------------------------------------------------------------- */

const CONTINUUM_UI = {
  zh: {
    coreOrigin: '个人常驻内核',
    coreSub: 'Runtime · Cognition · Realm',
    hint: '同一套内核随现实工程步骤向外投射：从桌面主机、远程直连到泛在日常空间',
    endpoint: '远程端',
    p2p: '点对点直连',
    pcHost: '主电脑',
    spaces: ['家庭节点', '工作空间', '出行声场'],
  },
  en: {
    coreOrigin: 'Personal Core',
    coreSub: 'Runtime · Cognition · Realm',
    hint: 'One persistent core projecting outward—from your PC today to direct P2P links and ambient spaces',
    endpoint: 'Endpoint',
    p2p: 'Direct P2P',
    pcHost: 'PC Host',
    spaces: ['Home Node', 'Workspace', 'In-Transit'],
  },
} as const;

export function PlatformContinuumSection({
  locale,
  stages,
}: {
  locale: LandingLocale;
  stages: ReadonlyArray<{
    id: StageId;
    step: string;
    status: string;
    title: string;
    body: string;
    milestones: ReadonlyArray<string>;
  }>;
}) {
  const ui = CONTINUUM_UI[locale];

  return (
    <div className="platform-continuum-interactive">
      {/* Unified Spatial Projection Origin */}
      <div className="platform-projection-hub" aria-hidden="true">
        <div className="platform-projection-origin">
          <img src="/logo.svg" alt="" width={20} height={20} />
          <div>
            <strong>{ui.coreOrigin}</strong>
            <small>{ui.coreSub}</small>
          </div>
          <p>{ui.hint}</p>
        </div>

        <svg className="platform-projection-svg" viewBox="0 0 1000 50" preserveAspectRatio="none">
          {[166, 500, 834].map((tx, idx) => {
            const d = `M 500 0 C 500 25, ${tx} 20, ${tx} 50`;
            return (
              <g key={tx}>
                <path
                  d={d}
                  className={`platform-proj-arc${idx === 2 ? ' is-dashed' : ' is-lit'}`}
                />
                {idx < 2 && (
                  <path
                    d={d}
                    className={`platform-proj-beam${idx === 1 ? ' is-cyan' : ''}`}
                    style={{ animationDelay: `${idx * -0.5}s` }}
                  />
                )}
                <circle cx={tx} cy="45" r="4.5" className={`platform-proj-dot${idx === 0 ? ' is-focus' : ''}`} />
              </g>
            );
          })}
        </svg>
      </div>

      <div className="public-domain-grid platform-horizon-grid">
        {stages.map((stage) => {
          const Icon = STAGE_ICONS[stage.id];
          return (
            <article
              key={stage.id}
              className={`public-domain-card platform-horizon-card is-${stage.id}${stage.id === 'desktop' ? ' is-current' : ''}`}
              data-topology-stage={stage.id}
            >
              <div className="public-domain-card-top">
                <span className="story-pillar-icon story-portal-icon" aria-hidden="true">
                  <Icon size={20} />
                </span>
                <span className={`public-domain-badge story-portal-badge${stage.id === 'desktop' ? ' is-live' : ''}`}>
                  {stage.status}
                </span>
              </div>
              <span className="platform-horizon-step">{stage.step}</span>
              <h3>{stage.title}</h3>
              <p className="public-domain-summary">{stage.body}</p>

              {stage.id === 'desktop' && (
                <div className="platform-horizon-visual is-icons" aria-hidden="true">
                  <img src="/logo.svg" alt="" width={28} height={28} />
                  <img src="/demo/zhiyu-icon.png" alt="" width={28} height={28} />
                  <img src="/demo/vane-icon.png" alt="" width={28} height={28} />
                  <img src="/demo/parentos-icon.png" alt="" width={28} height={28} />
                  <img src="/demo/openmontage-icon.png" alt="" width={28} height={28} />
                  <span>+19</span>
                </div>
              )}

              {stage.id === 'remote' && (
                <div className="platform-horizon-visual is-tunnel" aria-hidden="true">
                  <span>{ui.endpoint}</span>
                  <i className="platform-tunnel-line"><b /></i>
                  <strong>{ui.p2p}</strong>
                  <i className="platform-tunnel-line is-reverse"><b /></i>
                  <span>{ui.pcHost}</span>
                </div>
              )}

              {stage.id === 'roadmap' && (
                <div className="platform-horizon-visual is-wireframe" aria-hidden="true">
                  {ui.spaces.map((sp) => (
                    <span key={sp}>{sp}</span>
                  ))}
                </div>
              )}

              <ul className="platform-horizon-list">
                {stage.milestones.map((item) => (
                  <li key={item}>
                    <Check size={14} aria-hidden="true" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </article>
          );
        })}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Chapter 04: Clean 4-Column Sovereign Ledger with Visual Micro-Diagrams     */
/* -------------------------------------------------------------------------- */

const SOVEREIGN_UI = {
  zh: {
    codes: ['01 · 存储主权', '02 · 权限隔离', '03 · 离线韧性', '04 · 开源可验'],
    vaultPath: '~/NimiVault',
    vaultBadge: '0 MB 强制预装',
    vaultFoot: '首次启动自主选定目录',
    scopeAllow: '已声明调用',
    scopeDeny: '越界默认拒绝',
    scopeFoot: '独立分区物理隔离',
    wanCut: '外网中断时',
    localKeep: '本机 AI 照常运转',
    sigValid: 'Ed25519 验签',
    sigDigest: 'SHA-256 公示',
  },
  en: {
    codes: ['01 · STORAGE', '02 · ISOLATION', '03 · RESILIENCE', '04 · VERIFIABLE'],
    vaultPath: '~/NimiVault',
    vaultBadge: '0 MB Gate',
    vaultFoot: 'Selected on first launch',
    scopeAllow: 'Declared Scope',
    scopeDeny: 'Undeclared Denied',
    scopeFoot: 'Isolated app partitions',
    wanCut: 'When Offline',
    localKeep: 'Local AI Stays Live',
    sigValid: 'Ed25519 Signed',
    sigDigest: 'SHA-256 Public',
  },
} as const;

export function PlatformSovereignConsole({
  locale,
  dataRoot,
  permissions,
  resilience,
  signing,
}: {
  locale: LandingLocale;
  dataRoot: { title: string; body: string };
  permissions: { title: string; body: string };
  resilience: { title: string; body: string; link: string };
  signing: { title: string; body: string; link: string };
}) {
  const ui = SOVEREIGN_UI[locale];

  return (
    <div className="platform-trust-ledger platform-sovereign-console">
      {/* 01: Local Data Root */}
      <article className="platform-ledger-item">
        <div className="platform-ledger-head">
          <code>{ui.codes[0]}</code>
          <FolderLock size={18} aria-hidden="true" />
        </div>
        <h3>{dataRoot.title}</h3>
        <p>{dataRoot.body}</p>
        <div className="platform-sovereign-diagram" aria-hidden="true">
          <div className="platform-sov-row">
            <code>{ui.vaultPath}</code>
            <span className="is-ok">{ui.vaultBadge}</span>
          </div>
        </div>
        <span className="platform-ledger-foot-note">{ui.vaultFoot}</span>
      </article>

      {/* 02: App Scope Isolation */}
      <article className="platform-ledger-item">
        <div className="platform-ledger-head">
          <code>{ui.codes[1]}</code>
          <Lock size={18} aria-hidden="true" />
        </div>
        <h3>{permissions.title}</h3>
        <p>{permissions.body}</p>
        <div className="platform-sovereign-diagram" aria-hidden="true">
          <div className="platform-sov-pair">
            <span className="is-ok"><Check size={11} />{ui.scopeAllow}</span>
            <span className="is-deny"><X size={11} />{ui.scopeDeny}</span>
          </div>
        </div>
        <span className="platform-ledger-foot-note">{ui.scopeFoot}</span>
      </article>

      {/* 03: Offline Resilience */}
      <article className="platform-ledger-item">
        <div className="platform-ledger-head">
          <code>{ui.codes[2]}</code>
          <WifiOff size={18} aria-hidden="true" />
        </div>
        <h3>{resilience.title}</h3>
        <p>{resilience.body}</p>
        <div className="platform-sovereign-diagram" aria-hidden="true">
          <div className="platform-sov-row">
            <small>{ui.wanCut}</small>
            <span className="is-ok">● {ui.localKeep}</span>
          </div>
        </div>
        <Link to={withLocaleQuery('/account', locale)} className="story-link">
          <span>{resilience.link}</span>
          <ArrowRight size={15} aria-hidden="true" />
        </Link>
      </article>

      {/* 04: Open Core & Signed Releases */}
      <article className="platform-ledger-item">
        <div className="platform-ledger-head">
          <code>{ui.codes[3]}</code>
          <ShieldCheck size={18} aria-hidden="true" />
        </div>
        <h3>{signing.title}</h3>
        <p>{signing.body}</p>
        <div className="platform-sovereign-diagram" aria-hidden="true">
          <div className="platform-sov-pair">
            <span className="is-ok"><Check size={11} />{ui.sigValid}</span>
            <code>{ui.sigDigest}</code>
          </div>
        </div>
        <Link to={withLocaleQuery('/code-signing', locale)} className="story-link">
          <span>{signing.link}</span>
          <ArrowRight size={15} aria-hidden="true" />
        </Link>
      </article>
    </div>
  );
}
