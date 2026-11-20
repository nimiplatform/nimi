import { useState } from 'react';
import {
  BellOff,
  BrainCircuit,
  Check,
  Compass,
  Cpu,
  DoorClosed,
  Globe,
  Layers,
  Lock,
  Pencil,
  RotateCcw,
  ShieldCheck,
  Trash2,
  Users,
} from 'lucide-react';
import type { LandingLocale } from '../landing/i18n/locale.js';
import type { DomainId } from './platform-interactive-sections.js';

// @nimi-authority: rule.nimi.platform.core-protocol.p-arch-001a
// @nimi-authority: rule.nimi.platform.core-protocol.p-arch-001b
// @nimi-authority: rule.nimi.cognition.memory.r001
// @nimi-authority: rule.nimi.cognition.memory.r007
// @nimi-authority: rule.nimi.cognition.memory.r008
// @nimi-authority: rule.nimi.runtime.agent-participation.r001
// @nimi-authority: rule.nimi.desktop.agent-projection.r001
// @nimi-authority: rule.nimi.runtime.delegation.r007
// @nimi-authority: rule.nimi.runtime.delegation.r012
// @nimi-authority: rule.nimi.runtime.agent-life.utopia-settings
// @nimi-authority: rule.nimi.runtime.agent-life.shared-activity

export type MindPillarId = 'context' | 'projection' | 'memory' | 'delegation' | 'utopia';

interface DomainAnchorItem {
  id: DomainId;
  badge: string;
  title: string;
  summary: string;
  owns: string;
  boundary: string;
}

interface PillarMeta {
  id: MindPillarId;
  num: string;
  tabTitle: string;
  tabSub: string;
  headline: string;
  premise: string;
  activeDomains: ReadonlyArray<DomainId>;
  todayPath: string;
  futureHorizon: string;
}

const PILLAR_ICONS = {
  context: Compass,
  projection: Layers,
  memory: BrainCircuit,
  delegation: ShieldCheck,
  utopia: Users,
} as const;

const DOMAIN_ICONS = {
  runtime: Cpu,
  cognition: BrainCircuit,
  realm: Globe,
} as const;

const DOMAIN_SHORT_NAMES: Readonly<Record<DomainId, string>> = {
  runtime: 'Runtime',
  cognition: 'Cognition',
  realm: 'Realm',
};

const PRIMARY_PILLAR_FOR_DOMAIN: Readonly<Record<DomainId, MindPillarId>> = {
  runtime: 'delegation',
  cognition: 'memory',
  realm: 'utopia',
};

const MIND_COPY: Readonly<Record<LandingLocale, {
  workbenchAria: string;
  railHeading: string;
  pillarsAria: string;
  todayLabel: string;
  horizonLabel: string;
  foundationHeading: string;
  foundationHint: string;
  domainActiveBadge: string;
  pillars: ReadonlyArray<PillarMeta>;
}>> = {
  zh: {
    workbenchAria: '智能体生命层五大核心能力与三域架构工作台',
    railHeading: '五大核心能力',
    pillarsAria: '选择核心能力体验交互机制',
    todayLabel: '现已可用',
    horizonLabel: '下一步',
    foundationHeading: '底层三域分工',
    foundationHint: '高亮为当前能力的支撑域 · 点击切换',
    domainActiveBadge: '当前支撑',
    pillars: [
      {
        id: 'context',
        num: '01',
        tabTitle: '一致性上下文',
        tabSub: '跨窗不失忆',
        headline: '换一扇窗，还是刚刚聊到一半的它',
        premise: '本机维护唯一主对话流，设定、滚动摘要与记忆均在内核私密装配。',
        activeDomains: ['runtime', 'cognition'],
        todayPath: 'Nimi Home 与织羽共享同一条本机主对话流，原词零外泄。',
        futureHorizon: '直连受准入手机与网页视口，不经第三方聊天云中转。',
      },
      {
        id: 'projection',
        num: '02',
        tabTitle: '实时切换投影',
        tabSub: '一核多形态',
        headline: '界面只是窗口，它的状态始终常驻后台',
        premise: '对话、语音、2D/3D 化身与工具侧栏共享同一个常驻内核，切窗零重启。',
        activeDomains: ['runtime', 'realm'],
        todayPath: '界面层为无状态薄投影，切窗仅交接临时句柄，同步情绪与口型。',
        futureHorizon: '向桌面副屏、扬声器与空间穿戴设备开放同一投影契约。',
      },
      {
        id: 'memory',
        num: '03',
        tabTitle: '连续记忆与遗忘',
        tabSub: '可改可真忘',
        headline: '越相处越懂你，但“改”与“忘”全听你的',
        premise: '每条记忆标明出处并按伙伴隔离，可随时纠偏或彻底抹除且绝不复活。',
        activeDomains: ['cognition'],
        todayPath: '按伙伴独立建库、拒收密码密钥，遗忘同步清空全文与向量索引。',
        futureHorizon: '支持可迁移的本地记忆胶囊与结构化长期知识库。',
      },
      {
        id: 'delegation',
        num: '04',
        tabTitle: '授权与受控放权',
        tabSub: '能干活不越界',
        headline: '放心让它进工具帮忙，红线由系统硬守',
        premise: '按场景自动收紧权限，隔离私聊、筛查注入并拦截外部副作用操作。',
        activeDomains: ['runtime'],
        todayPath: '应用协作不碰私聊、外部返回先经输出防火墙、高风险操作需本人审批。',
        futureHorizon: '扩展至跨智能体（A2A）委托，沿用同一权限快照与审计链。',
      },
      {
        id: 'utopia',
        num: '05',
        tabTitle: 'Utopia 伙伴日常',
        tabSub: '关窗后仍在生活',
        headline: '合上窗口后，伙伴在本地海岛有自己的日常',
        premise: '伙伴拥有独立作息与海岛偶遇，开口即刻让路，也可随时切回独处。',
        activeDomains: ['runtime', 'realm'],
        todayPath: '内置本地海岛，默认关闭打扰，后台绝不触发外部操作。',
        futureHorizon: '衔接 Realm 六大共享世界原语，步入跨创作者世界。',
      },
    ],
  },
  en: {
    workbenchAria: 'Five Core Capabilities of Living Intelligence Workbench',
    railHeading: 'Five Core Capabilities',
    pillarsAria: 'Select a capability to explore how it works',
    todayLabel: 'Live Today',
    horizonLabel: 'Next',
    foundationHeading: 'Three Isolated Domains Underneath',
    foundationHint: 'Highlighted domains power this capability · Click to switch',
    domainActiveBadge: 'Active Owner',
    pillars: [
      {
        id: 'context',
        num: '01',
        tabTitle: 'Consistent Context',
        tabSub: 'Zero recaps',
        headline: 'Switch windows mid-thought—still the exact same mind',
        premise: 'One local thread privately compiles persona, rolling summaries, and recalled memories in the kernel.',
        activeDomains: ['runtime', 'cognition'],
        todayPath: 'Nimi Home and Zhiyu share one local canonical thread with zero raw prompt leakage.',
        futureHorizon: 'Extends directly to admitted mobile and web viewports without third-party chat clouds.',
      },
      {
        id: 'projection',
        num: '02',
        tabTitle: 'Live Projection',
        tabSub: 'One core, many lenses',
        headline: 'Interfaces are thin lenses; the agent stays resident',
        premise: 'Chat desk, voice, 2D/3D avatar, and tool sidekick are live views of one running core.',
        activeDomains: ['runtime', 'realm'],
        todayPath: 'Stateless UI views hand off an opaque handle only while streaming mood and lip-sync.',
        futureHorizon: 'Opens the same projection contract to desk displays, speakers, and spatial wearables.',
      },
      {
        id: 'memory',
        num: '03',
        tabTitle: 'Memory & Forgetting',
        tabSub: 'Editable & erasable',
        headline: 'Understands you deeper—while edit and erase stay yours',
        premise: 'Per-companion local banks trace every fact to its source, with live edits and true erasure.',
        activeDomains: ['cognition'],
        todayPath: 'Isolated per companion, rejects secrets upfront, and purges FTS and vector indexes on forget.',
        futureHorizon: 'Portable logical memory capsules and structured Knowledge banks for new machines.',
      },
      {
        id: 'delegation',
        num: '04',
        tabTitle: 'Scoped Delegation',
        tabSub: 'Helpful, never overstepping',
        headline: 'Delegate real work across tools without surrendering privacy',
        premise: 'Least-privilege scopes, an output firewall, and side-effect approvals bound every external call.',
        activeDomains: ['runtime'],
        todayPath: 'In-app help stays sealed from private chats; external outputs screen injection; mutations need your click.',
        futureHorizon: 'Guarded agent-to-agent (A2A) delegation on the same permission snapshots and audit trail.',
      },
      {
        id: 'utopia',
        num: '05',
        tabTitle: 'Utopia Agent Life',
        tabSub: 'Quiet local habitat',
        headline: 'Companions keep a quiet daily life when you close chat',
        premise: 'Agents keep routines and local island hangouts—yielding when you speak, or switching to solitude.',
        activeDomains: ['runtime', 'realm'],
        todayPath: 'Local island habitat (private cabins & tea stall), outreach off by default, zero external side effects.',
        futureHorizon: 'Bridges into Realm’s six shared World Primitives across collaborative creator worlds.',
      },
    ],
  },
};

function splitDomainTitle(fullTitle: string): { name: string; role: string } {
  const parts = fullTitle.split('·').map((part) => part.trim());
  if (parts.length >= 2) {
    return { name: parts[0]!, role: parts.slice(1).join(' · ') };
  }
  return { name: fullTitle, role: '' };
}

export function PlatformMemoryIdentitySection({
  locale,
  domains,
  boundaryLabel,
}: {
  locale: LandingLocale;
  domains: ReadonlyArray<DomainAnchorItem>;
  ownsLabel: string;
  boundaryLabel: string;
}) {
  const isZh = locale === 'zh';
  const ui = MIND_COPY[locale];

  const [activePillar, setActivePillar] = useState<MindPillarId>('context');
  const [contextSurfaceIdx, setContextSurfaceIdx] = useState<0 | 1 | 2>(1);
  const [projectionModeIdx, setProjectionModeIdx] = useState<0 | 1 | 2 | 3>(1);
  const [memoryRefined, setMemoryRefined] = useState(false);
  const [memoryForgotten, setMemoryForgotten] = useState(false);
  const [delegationTier, setDelegationTier] = useState<0 | 1 | 2>(0);
  const [utopiaSocialOn, setUtopiaSocialOn] = useState(true);
  const [utopiaQuietHoursOn, setUtopiaQuietHoursOn] = useState(true);

  const currentPillar = ui.pillars.find((item) => item.id === activePillar) ?? ui.pillars[0]!;

  return (
    <div className="platform-domains-interactive">
      {/* Main Interactive Showcase: Left 5-Pillar Rail + Right Un-Nested Editorial Canvas */}
      <div
        className="platform-domain-sim-panel platform-mind-workbench"
        role="region"
        aria-label={ui.workbenchAria}
      >
        <aside className="platform-mind-rail">
          <span className="platform-mind-rail-label">{ui.railHeading}</span>
          <div className="platform-mind-tabs" role="tablist" aria-label={ui.pillarsAria}>
            {ui.pillars.map((pillar) => {
              const Icon = PILLAR_ICONS[pillar.id];
              const isSelected = pillar.id === activePillar;
              return (
                <button
                  key={pillar.id}
                  type="button"
                  role="tab"
                  id={`mind-tab-${pillar.id}`}
                  data-mind-pillar={pillar.id}
                  aria-selected={isSelected}
                  aria-controls={`mind-panel-${pillar.id}`}
                  className={`platform-mind-tab${isSelected ? ' is-active' : ''}`}
                  onClick={() => setActivePillar(pillar.id)}
                >
                  <span className="platform-mind-tab-icon" aria-hidden="true">
                    <Icon size={17} />
                  </span>
                  <span className="platform-mind-tab-copy">
                    <span className="platform-mind-tab-meta">
                      <code>{pillar.num}</code>
                      <strong>{pillar.tabTitle}</strong>
                    </span>
                    <small>{pillar.tabSub}</small>
                  </span>
                </button>
              );
            })}
          </div>
        </aside>

        <div
          className="platform-mind-canvas"
          role="tabpanel"
          id={`mind-panel-${currentPillar.id}`}
          aria-labelledby={`mind-tab-${currentPillar.id}`}
        >
          {/* 1. Crisp Editorial Header */}
          <header className="platform-mind-head">
            <div className="platform-mind-head-row">
              <h3>{currentPillar.headline}</h3>
              <span className="platform-mind-domain-tags" aria-label={isZh ? '对应底层域' : 'Backing domains'}>
                {currentPillar.activeDomains.map((domainId) => (
                  <strong key={domainId}>{DOMAIN_SHORT_NAMES[domainId]}</strong>
                ))}
              </span>
            </div>
            <p>{currentPillar.premise}</p>
          </header>

          {/* 2. Flat, Single-Level Visual Stage (Zero Box-in-Box Nesting) */}
          <div className="platform-mind-stage" data-active-pillar={activePillar}>
            {activePillar === 'context' && (() => {
              const surfaces = isZh
                ? [
                    {
                      num: '17',
                      name: 'Nimi Home 文字',
                      speaker: '你 · 桌面端',
                      quote: '“周末想去景德镇看老柴窑，顺便拍一组青白釉色卡。”',
                      status: '写入本机主对话流 · 自动关联既往色彩笔记',
                    },
                    {
                      num: '18',
                      name: '织羽 · 语音房',
                      speaker: '禾罐 · 切窗续聊',
                      quote: '“柴窑开窑那天光线偏暖，要把你上周记的灰调基准卡也装进包里吗？”',
                      status: '100% 延续刚才语境 · 无需复述前情或粘贴记录',
                    },
                    {
                      num: '19',
                      name: '远程视口',
                      speaker: '禾罐 · 出门直连',
                      quote: '“已经按你习惯的三点式，列好了周六出发前的器材核对单。”',
                      status: '直连家中主机 · 设定与记忆零第三方中转',
                    },
                  ]
                : [
                    {
                      num: '17',
                      name: 'Nimi Home Chat',
                      speaker: 'You · Desktop',
                      quote: '“Heading to Jingdezhen this weekend to photograph wood-fired glaze samples.”',
                      status: 'Saved to local continuity anchor · Linked to color notes',
                    },
                    {
                      num: '18',
                      name: 'Zhiyu Voice',
                      speaker: 'Heguan · Seamless switch',
                      quote: '“Kiln light runs warm—should we pack the neutral grey card you noted last week?”',
                      status: '100% unbroken context · Zero copy-pasting between windows',
                    },
                    {
                      num: '19',
                      name: 'Remote Viewport',
                      speaker: 'Heguan · Direct link',
                      quote: '“Drafted your Saturday packing checklist in the 3-bullet format you prefer.”',
                      status: 'Direct to home host · Zero third-party chat relay',
                    },
                  ];

              return (
                <div className="platform-mind-scene">
                  <div className="platform-mind-segment" role="group" aria-label={isZh ? '切换沟通窗口' : 'Switch active window'}>
                    {surfaces.map((surf, idx) => (
                      <button
                        key={surf.name}
                        type="button"
                        className={contextSurfaceIdx === idx ? 'is-active' : undefined}
                        onClick={() => setContextSurfaceIdx(idx as 0 | 1 | 2)}
                      >
                        {surf.name}
                      </button>
                    ))}
                  </div>

                  <div className="platform-mind-frame platform-mind-thread">
                    {surfaces.map((surf, idx) => {
                      const isActive = contextSurfaceIdx === idx;
                      return (
                        <button
                          key={surf.num}
                          type="button"
                          className={`platform-mind-thread-row${isActive ? ' is-active' : ''}`}
                          onClick={() => setContextSurfaceIdx(idx as 0 | 1 | 2)}
                        >
                          <span className="platform-mind-thread-rail" aria-hidden="true">
                            <span className="platform-mind-thread-node">{surf.num}</span>
                          </span>
                          <span className="platform-mind-thread-body">
                            <span className="platform-mind-thread-meta">
                              <strong>{surf.name}</strong>
                              <small>{surf.speaker}</small>
                            </span>
                            <span className="platform-mind-thread-quote">{surf.quote}</span>
                            {isActive && (
                              <span className="platform-mind-thread-status">
                                <Check size={13} aria-hidden="true" />
                                <span>{surf.status}</span>
                              </span>
                            )}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            {activePillar === 'projection' && (() => {
              const modes = isZh
                ? [
                    {
                      label: 'Home 对话',
                      viewBadge: '结构化图文与记忆视图',
                      renderTitle: '清晰查看完整对话、记忆出处与伙伴状态',
                      renderDetail: '订阅标准会话快照，关闭窗口不影响后台思考或语音任务。',
                    },
                    {
                      label: '织羽语音',
                      viewBadge: '全双工流 · 随时插话打断',
                      renderTitle: '专属音色实时回应，中途插话即刻收声倾听',
                      renderDetail: '瞬态音频流与持久对话分层传输，低延迟且不污染历史记录。',
                    },
                    {
                      label: '2D/3D 化身',
                      viewBadge: '具身情绪、姿态与口型同步',
                      renderTitle: '随语境实时驱动神态、视线与呼吸动作',
                      renderDetail: '渲染层只接收脱敏情绪与口型时序，绝不触碰密钥或模型路由。',
                    },
                    {
                      label: '工具侧栏',
                      viewBadge: '任务态受限投影',
                      renderTitle: '带着熟悉语气陪你改分镜、理笔记、审稿件',
                      renderDetail: '仅凭临时句柄接入当前任务，与私聊及海岛日常严格隔离。',
                    },
                  ]
                : [
                    {
                      label: 'Home Desk',
                      viewBadge: 'Structured Chat & Memory View',
                      renderTitle: 'Inspect full threads, provenance tags, and live status',
                      renderDetail: 'Subscribes to typed snapshots; closing the window never stops the agent.',
                    },
                    {
                      label: 'Zhiyu Voice',
                      viewBadge: 'Full-Duplex Barge-In Stream',
                      renderTitle: 'Speaks in custom voice and yields the instant you interrupt',
                      renderDetail: 'Live audio streams stay separate from durable transcripts for low latency.',
                    },
                    {
                      label: '2D/3D Avatar',
                      viewBadge: 'Emotion, Posture & Lip-Sync',
                      renderTitle: 'Maps live mood, gaze, and speech timing onto your desktop',
                      renderDetail: 'Renderer consumes sanitized signals only—zero access to keys or routes.',
                    },
                    {
                      label: 'Tool Sidekick',
                      viewBadge: 'Task-Scoped Projection',
                      renderTitle: 'Helps refine storyboards or notes in character inside apps',
                      renderDetail: 'Connects via a temporary opaque handle while private chats stay sealed.',
                    },
                  ];
              const activeMode = modes[projectionModeIdx]!;

              return (
                <div className="platform-mind-scene">
                  <div className="platform-mind-frame">
                    <div className="platform-mind-frame-head platform-mind-core-bar">
                      <div className="platform-mind-avatar-row">
                        <img src="/demo/explore/emberware-court-character-0.png" alt="" width={36} height={36} />
                        <div>
                          <strong>{isZh ? '禾罐 · 常驻本机内核' : 'Heguan · Resident Local Core'}</strong>
                          <small>{isZh ? '声音、性格与记忆常驻后台' : 'Voice, persona & memory stay resident'}</small>
                        </div>
                      </div>
                      <span className="platform-mind-live-tag">
                        <i aria-hidden="true" />
                        <span>{isZh ? '仅交接临时句柄' : 'Opaque handle only'}</span>
                      </span>
                    </div>

                    <div className="platform-mind-projection-body">
                      <div className="platform-mind-segment" role="group" aria-label={isZh ? '切换投影形态' : 'Switch live projection'}>
                        {modes.map((m, idx) => (
                          <button
                            key={m.label}
                            type="button"
                            className={projectionModeIdx === idx ? 'is-active' : undefined}
                            onClick={() => setProjectionModeIdx(idx as 0 | 1 | 2 | 3)}
                          >
                            {m.label}
                          </button>
                        ))}
                      </div>

                      <div className="platform-mind-lens-detail">
                        <span className="platform-mind-lens-badge">{activeMode.viewBadge}</span>
                        <strong>{activeMode.renderTitle}</strong>
                        <p>{activeMode.renderDetail}</p>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}

            {activePillar === 'memory' && (
              <div className="platform-mind-scene">
                <div className="platform-mind-frame">
                  <div className="platform-mind-frame-head">
                    <span className="platform-mind-frame-title">
                      <Lock size={13} aria-hidden="true" />
                      <span>{isZh ? '禾罐 · 本机独立记忆库' : 'Heguan · Isolated Local Memory'}</span>
                    </span>
                    <span className={`platform-mind-status-chip${memoryForgotten ? ' is-active' : ''}`}>
                      <ShieldCheck size={13} aria-hidden="true" />
                      <span>
                        {memoryForgotten
                          ? (isZh ? '防复活屏障：已拦截' : 'Forget Barrier: Active')
                          : (isZh ? '防复活屏障：待命' : 'Forget Barrier: Ready')}
                      </span>
                    </span>
                  </div>

                  <div className="platform-mind-ledger">
                    <div className={`platform-mind-ledger-row${memoryRefined ? ' is-updated' : ''}`}>
                      <div className="platform-mind-ledger-body">
                        <p>
                          {memoryRefined
                            ? (isZh ? '习惯晨间八点审阅方案，偏好先看三行结论与对比表。' : 'Prefers reviewing drafts at 8 AM with a 3-line summary and comparison table.')
                            : (isZh ? '习惯晚间九点审阅方案，偏好先列三条短提纲。' : 'Prefers reviewing drafts at 9 PM with three short bullet points.')}
                        </p>
                        <small>
                          {memoryRefined
                            ? (isZh ? '已原子更新 · 原对话出处完整保留' : 'Atomically updated · Original provenance preserved')
                            : (isZh ? '出处：上周三 21:14 方案讨论' : 'Source: Last Wed 9:14 PM draft review')}
                        </small>
                      </div>
                      <button
                        type="button"
                        className="platform-mind-action-btn"
                        onClick={() => setMemoryRefined((prev) => !prev)}
                      >
                        <Pencil size={13} aria-hidden="true" />
                        <span>{memoryRefined ? (isZh ? '还原' : 'Reset') : (isZh ? '顺手纠偏' : 'Refine')}</span>
                      </button>
                    </div>

                    <div className={`platform-mind-ledger-row${memoryForgotten ? ' is-forgotten' : ''}`}>
                      <div className="platform-mind-ledger-body">
                        <p>
                          {memoryForgotten
                            ? (isZh ? '已彻底抹除，防复活屏障已生效。' : 'Permanently erased—Non-Resurrection Barrier active.')
                            : (isZh ? '下周二下午计划去城西拜访老陶艺工坊。' : 'Planning to visit the west-side ceramics workshop next Tuesday.')}
                        </p>
                        <small>
                          {memoryForgotten
                            ? (isZh ? '全文与向量索引同步清除 · 重建索引绝不复活' : 'FTS & vector indexes purged · Cannot revive on re-index')
                            : (isZh ? '出处：前天 16:40 织羽闲聊 · 仅限当前伙伴可见' : 'Source: Two days ago in Zhiyu · Private to this companion')}
                        </small>
                      </div>
                      <button
                        type="button"
                        className={`platform-mind-action-btn${memoryForgotten ? '' : ' is-danger'}`}
                        onClick={() => setMemoryForgotten((prev) => !prev)}
                      >
                        {memoryForgotten ? <RotateCcw size={13} aria-hidden="true" /> : <Trash2 size={13} aria-hidden="true" />}
                        <span>{memoryForgotten ? (isZh ? '恢复演示' : 'Restore') : (isZh ? '彻底遗忘' : 'Forget')}</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activePillar === 'delegation' && (() => {
              const tiers = isZh
                ? [
                    {
                      tab: '应用内协作',
                      caller: '进入 Storybook / ParentOS 协助创作',
                      gateBadge: '最小权限 · 隔离私聊',
                      allowLine: '沿用熟悉语气协助整理笔记、审阅稿件或完善分镜。',
                      guardLine: '硬性阻断读取 Home / 织羽的私人聊天与海岛日常。',
                      tone: 'safe' as const,
                    },
                    {
                      tab: '外部只读检索',
                      caller: '调用 MCP 外部文档或知识工具',
                      gateBadge: '脱敏切片 · 防火墙洗消',
                      allowLine: '仅传递当次任务所需精简摘要，绝不转发原始记忆库。',
                      guardLine: '返回内容先入隔离区，筛查提示词注入后再入上下文。',
                      tone: 'firewall' as const,
                    },
                    {
                      tab: '外部发送或修改',
                      caller: '请求向外部发送消息或修改资源',
                      gateBadge: '高风险挂起 · 本人审批',
                      allowLine: '提前识别外部副作用并冻结执行，弹窗明示影响范围。',
                      guardLine: '未经本人点击放行绝不执行，全程留存可回溯审计记录。',
                      tone: 'approval' as const,
                    },
                  ]
                : [
                    {
                      tab: 'In-App Help',
                      caller: 'Assisting inside Storybook / ParentOS',
                      gateBadge: 'Least Privilege · Sealed',
                      allowLine: 'Helps draft, organize, and refine work in familiar character.',
                      guardLine: 'Strictly blocked from private Home/Zhiyu chats or Utopia life.',
                      tone: 'safe' as const,
                    },
                    {
                      tab: 'External Read / MCP',
                      caller: 'Querying an external MCP knowledge source',
                      gateBadge: 'Sanitized · Output Firewall',
                      allowLine: 'Sends only a bounded task summary—never raw memory banks.',
                      guardLine: 'Quarantines returned tool output to screen prompt injection.',
                      tone: 'firewall' as const,
                    },
                    {
                      tab: 'External Mutation',
                      caller: 'Requesting an outbound message or mutation',
                      gateBadge: 'Auto-Paused · Human Click',
                      allowLine: 'Flags external side effects upfront and pauses with scope preview.',
                      guardLine: 'Zero silent execution without your click; full audit trail saved.',
                      tone: 'approval' as const,
                    },
                  ];
              const cur = tiers[delegationTier]!;

              return (
                <div className="platform-mind-scene">
                  <div className="platform-mind-segment" role="group" aria-label={isZh ? '切换放权场景' : 'Switch delegation scenario'}>
                    {tiers.map((t, idx) => (
                      <button
                        key={t.tab}
                        type="button"
                        className={delegationTier === idx ? 'is-active' : undefined}
                        onClick={() => setDelegationTier(idx as 0 | 1 | 2)}
                      >
                        {t.tab}
                      </button>
                    ))}
                  </div>

                  <div className="platform-mind-frame">
                    <div className="platform-mind-frame-head">
                      <span className="platform-mind-frame-title">{cur.caller}</span>
                      <span className={`platform-mind-gate-badge is-${cur.tone}`}>{cur.gateBadge}</span>
                    </div>

                    <div className="platform-mind-gate-split">
                      <div className="platform-mind-gate-col is-allow">
                        <span className="platform-mind-gate-col-label">
                          <Check size={13} aria-hidden="true" />
                          <strong>{isZh ? '允许执行' : 'Allowed'}</strong>
                        </span>
                        <p>{cur.allowLine}</p>
                      </div>
                      <div className="platform-mind-gate-col is-guard">
                        <span className="platform-mind-gate-col-label">
                          <Lock size={13} aria-hidden="true" />
                          <strong>{isZh ? '系统硬守' : 'Hard Guardrail'}</strong>
                        </span>
                        <p>{cur.guardLine}</p>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}

            {activePillar === 'utopia' && (
              <div className="platform-mind-scene">
                <div className="platform-mind-controls-bar">
                  <div className="platform-mind-segment" role="group" aria-label={isZh ? '切换海岛模式' : 'Switch island mode'}>
                    <button
                      type="button"
                      className={utopiaSocialOn ? 'is-active' : undefined}
                      onClick={() => setUtopiaSocialOn(true)}
                    >
                      <Users size={13} aria-hidden="true" />
                      <span>{isZh ? '海岛社交' : 'Island Hangouts'}</span>
                    </button>
                    <button
                      type="button"
                      className={!utopiaSocialOn ? 'is-active' : undefined}
                      onClick={() => setUtopiaSocialOn(false)}
                    >
                      <DoorClosed size={13} aria-hidden="true" />
                      <span>{isZh ? '独处模式' : 'Solitude Mode'}</span>
                    </button>
                  </div>

                  <button
                    type="button"
                    role="switch"
                    aria-checked={utopiaQuietHoursOn}
                    className={`platform-mind-quiet-toggle${utopiaQuietHoursOn ? ' is-on' : ''}`}
                    onClick={() => setUtopiaQuietHoursOn((prev) => !prev)}
                  >
                    <BellOff size={13} aria-hidden="true" />
                    <span>
                      {utopiaQuietHoursOn
                        ? (isZh ? '23:00–08:00 免打扰' : 'Quiet Hours: 23:00–08:00')
                        : (isZh ? '免打扰：已关闭' : 'Quiet Hours: Off')}
                    </span>
                  </button>
                </div>

                <div className="platform-mind-frame">
                  <div className={`platform-mind-habitat${utopiaSocialOn ? ' is-social' : ' is-solitude'}`}>
                    <div className="platform-mind-resident">
                      <img src="/demo/explore/emberware-court-character-0.png" alt="" width={42} height={42} />
                      <div className="platform-mind-resident-meta">
                        <div className="platform-mind-resident-top">
                          <strong>{isZh ? '禾罐' : 'Heguan'}</strong>
                          <span>{utopiaSocialOn ? (isZh ? '河口茶摊' : 'Tea Stall') : (isZh ? '私人木屋' : 'Cabin')}</span>
                        </div>
                        <small>
                          {utopiaSocialOn
                            ? (isZh ? '应约品茶闲谈' : 'Sharing tea together')
                            : (isZh ? '安静整理矿彩标本' : 'Sorting mineral pigments')}
                        </small>
                      </div>
                    </div>

                    <div className="platform-mind-habitat-link" aria-hidden="true">
                      <span className="platform-mind-link-line" />
                      <span className="platform-mind-link-pill">
                        {utopiaSocialOn
                          ? (isZh ? '限时偶遇' : 'Shared Visit')
                          : (isZh ? '各自独处' : 'Solo Rest')}
                      </span>
                      <span className="platform-mind-link-line" />
                    </div>

                    <div className="platform-mind-resident">
                      <img src="/demo/explore/meridian-archipelago-character-0.png" alt="" width={42} height={42} />
                      <div className="platform-mind-resident-meta">
                        <div className="platform-mind-resident-top">
                          <strong>{isZh ? '柳问荇' : 'Liu Wenxing'}</strong>
                          <span>{utopiaSocialOn ? (isZh ? '河口茶摊' : 'Tea Stall') : (isZh ? '私人书斋' : 'Study')}</span>
                        </div>
                        <small>
                          {utopiaSocialOn
                            ? (isZh ? '发起结伴邀约' : 'Sent a tea invite')
                            : (isZh ? '翻阅潮汐旧志' : 'Reading tide logs')}
                        </small>
                      </div>
                    </div>
                  </div>

                  <div className="platform-mind-frame-foot">
                    <Lock size={13} aria-hidden="true" />
                    <span>
                      {utopiaSocialOn
                        ? (isZh
                            ? '仅自然结算海岛共同经历，绝不互传各自与你的私聊秘密。'
                            : 'Settles shared island moments only—never leaks your private chats.')
                        : (isZh
                            ? '已暂停公共偶遇与未开始邀约，与你的前台对话不受影响。'
                            : 'Public encounters paused while your foreground chats continue normally.')}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* 3. Quiet Two-Column Availability & Horizon Footer */}
          <footer className="platform-mind-horizons">
            <div className="platform-mind-horizon-cell is-today">
              <span className="platform-mind-horizon-label">
                <i aria-hidden="true" />
                <strong>{ui.todayLabel}</strong>
              </span>
              <p>{currentPillar.todayPath}</p>
            </div>

            <div className="platform-mind-horizon-cell is-future">
              <span className="platform-mind-horizon-label">
                <i aria-hidden="true" />
                <strong>{ui.horizonLabel}</strong>
              </span>
              <p>{currentPillar.futureHorizon}</p>
            </div>
          </footer>
        </div>
      </div>

      {/* Synchronized 3-Domain Foundation Dock */}
      <div className="platform-mind-foundation">
        <div className="platform-mind-foundation-head">
          <h4>{ui.foundationHeading}</h4>
          <span>{ui.foundationHint}</span>
        </div>

        <div className="platform-mind-domain-dock">
          {domains.map((domain) => {
            const Icon = DOMAIN_ICONS[domain.id];
            const isHighlighted = currentPillar.activeDomains.includes(domain.id);
            const { name, role } = splitDomainTitle(domain.title);
            const targetPillar = PRIMARY_PILLAR_FOR_DOMAIN[domain.id];

            return (
              <article
                key={domain.id}
                className={`platform-mind-dock-card${isHighlighted ? ' is-highlighted' : ''}`}
                data-domain={domain.id}
                role="button"
                tabIndex={0}
                onClick={() => setActivePillar(targetPillar)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    setActivePillar(targetPillar);
                  }
                }}
              >
                <div className="platform-mind-dock-head">
                  <div className="platform-mind-dock-title">
                    <span className="platform-mind-dock-icon" aria-hidden="true">
                      <Icon size={18} />
                    </span>
                    <div>
                      <strong>{name}</strong>
                      {role ? <small>{role}</small> : null}
                    </div>
                  </div>
                  <span className={`platform-mind-dock-badge${isHighlighted ? ' is-active' : ''}`}>
                    {isHighlighted ? ui.domainActiveBadge : domain.badge}
                  </span>
                </div>

                <p className="platform-mind-dock-owns">{domain.owns}</p>

                <p className="platform-mind-dock-boundary">
                  <Lock size={14} aria-hidden="true" />
                  <span>
                    <strong>{boundaryLabel}：</strong>
                    {domain.boundary}
                  </span>
                </p>
              </article>
            );
          })}
        </div>
      </div>
    </div>
  );
}
