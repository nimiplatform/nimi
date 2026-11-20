import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUpRight,
  ShieldCheck,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import type { LandingLocale } from '../landing/i18n/locale.js';
import { CAPABILITY_LABELS } from './informational-content.js';
import { PlatformCapabilityPreview, SAMPLE_ICONS } from './platform-capability-preview.js';
import { PlatformCapabilityRouteCounts } from './platform-capability-routes.js';
import {
  CAPABILITY_SAMPLES,
  PLATFORM_CAPABILITIES,
  type CapabilityGroup,
  type CapabilityId,
} from './platform-capability-samples.js';
import { PlatformIntegrationsSection } from './platform-integrations-section.js';
import {
  PlatformContinuumSection,
  PlatformSovereignConsole,
  type DomainId,
  type StageId,
} from './platform-interactive-sections.js';
import { PlatformMemoryIdentitySection } from './platform-memory-identity-section.js';
import { PlatformStackStage } from './platform-stack-stage.js';
import {
  PublicSiteShell,
  usePublicDocumentMetadata,
  useResolvedPublicLinks,
} from './public-site-shell.js';
import { usePublicPageLocale } from './use-page-locale.js';

// @nimi-authority: rule.nimi.platform.core-protocol.p-arch-001a
// @nimi-authority: rule.nimi.platform.governance-release.p-gov-026-positioning
// @nimi-authority: rule.nimi.platform.governance-release.p-gov-026-owner-boundary
// @nimi-authority: rule.nimi.runtime.integration.custody
const CAPABILITY_GROUPS = ['text', 'visual', 'audio', 'realtime'] as const;
const ACTIVE_CAPABILITIES = CAPABILITY_GROUPS.flatMap((group) => (
  PLATFORM_CAPABILITIES[group].map((id) => ({ id, group }))
));

const PLATFORM_CAPABILITY_LABELS: typeof CAPABILITY_LABELS = {
  ...CAPABILITY_LABELS,
  en: {
    ...CAPABILITY_LABELS.en,
    'text.generate': 'Text & multimodal',
    'image.generate': 'Image generation',
    'video.generate': 'Video generation',
    'music.generate': 'Music generation',
    'realtime.interact': 'Realtime duplex',
  },
};

const PLATFORM_COPY: Readonly<Record<LandingLocale, {
  metaTitle: string;
  metaDescription: string;
  eyebrow: string;
  title: string;
  lead: string;
  downloadCta: string;
  roadmapCta: string;
  sourceCta: string;
  specCta: string;
  blueprintSwitchLabel: string;
  blueprintModeNimi: string;
  blueprintModeLegacy: string;
  blueprintTopTierLabel: string;
  blueprintTopTierNote: string;
  blueprintSurfaces: ReadonlyArray<{ name: string; tag: string; isFuture?: boolean }>;
  blueprintCoreLabel: string;
  blueprintCoreTitle: string;
  blueprintCorePillars: ReadonlyArray<{ name: string; role: string }>;
  blueprintBottomTierLabel: string;
  blueprintBottomTierNote: string;
  blueprintSubstrates: ReadonlyArray<string>;
  legacyCaption: string;
  legacySilos: ReadonlyArray<{ app: string; issue1: string; issue2: string }>;
  legacySummary: string;
  matrixEyebrow: string;
  matrixTitle: string;
  matrixLead: string;
  textSubFeaturesLabel: string;
  textSubFeatures: ReadonlyArray<string>;
  routingPrinciples: ReadonlyArray<string>;
  groups: Record<CapabilityGroup, { title: string; countBadge: string }>;
  capabilityGroupsLabel: string;
  capabilityFiltersLabel: string;
  capabilitySampleSourceLab: string;
  capabilitySampleSourceRuntime: string;
  planeBothBadge: string;
  planeLocalOnlyBadge: string;
  planeCloudLiveBadge: string;
  costBoundaryTitle: string;
  costBoundaryBody: string;
  integrationsEyebrow: string;
  integrationsTitle: string;
  integrationsLead: string;
  domainsEyebrow: string;
  domainsTitle: string;
  domainsLead: string;
  domainsOwnsLabel: string;
  domainsBoundaryLabel: string;
  domains: ReadonlyArray<{
    id: DomainId;
    badge: string;
    title: string;
    summary: string;
    owns: string;
    boundary: string;
  }>;
  openSourceBoundary: string;
  topologyEyebrow: string;
  topologyTitle: string;
  topologyLead: string;
  topologyStages: ReadonlyArray<{
    id: StageId;
    step: string;
    status: string;
    title: string;
    body: string;
    milestones: ReadonlyArray<string>;
  }>;
  trustEyebrow: string;
  trustTitle: string;
  trustLead: string;
  dataRoot: { title: string; body: string };
  permissions: { title: string; body: string };
  resilience: { title: string; body: string; link: string };
  signing: { title: string; body: string; link: string };
}>> = {
  zh: {
    metaTitle: '平台基座：以人为原点的个人 AI 架构 | Nimi',
    metaDescription: '把 20 项全感官算力、零暴露安全连接、长期记忆与跨端身份下沉为属于你个人的底层基座——向上支撑万千轻量应用，向外延伸至每一块屏幕。',
    eyebrow: 'Nimi Platform · 个人 AI 算力、连接与记忆基座',
    title: '把 AI 从孤岛软件里解放出来，沉降为属于你的底层基座',
    lead: '今天的 AI 是倒着建的：每装一款软件，不仅要重配密钥、把上下文锁进黑盒，多开几个本地应用还会争抢同一块显卡导致显存爆满与卡死。Nimi 将软件栈彻底反转——把统一模型调度、安全连接、长期记忆与跨端身份下沉为常驻基座，让未来十款、百款 AI 工具在同一台设备上丝滑共生。',
    downloadCta: '下载桌面版 Beta',
    roadmapCta: '查看已落地进度与演进',
    sourceCta: 'GitHub 开源仓库',
    specCta: '架构协议规范',
    blueprintSwitchLabel: '切换查看架构范式对比',
    blueprintModeNimi: 'Nimi 架构：一套个人基座，处处生长',
    blueprintModeLegacy: '现状困局：AI 被锁死在软件孤岛',
    blueprintTopTierLabel: '上层 · 轻盈生长的应用与终端窗口',
    blueprintTopTierNote: '不再各自捆绑庞大模型或圈占数据——即插即用，切换无损',
    blueprintSurfaces: [
      { name: 'Nimi Home', tag: '已落地' },
      { name: '23 款精选应用', tag: '已落地' },
      { name: '有声常驻伙伴', tag: '已落地' },
      { name: '授权网页与手机', tag: '协议就绪' },
      { name: '家庭节点与泛在空间终端', tag: '持续延伸', isFuture: true },
    ],
    blueprintCoreLabel: '中枢 · 属于你的常驻个人内核',
    blueprintCoreTitle: '算力调度、连续记忆与唯一身份在此合流——软件与设备变迁，内核始终随行',
    blueprintCorePillars: [
      { name: 'Runtime · 算力与连接内核', role: '统一抽象 20 项全感官算力与零暴露受控连接' },
      { name: 'Cognition · 记忆内核', role: '跨应用沉淀可溯源、可涂改的本地长期上下文' },
      { name: 'Realm · 身份与世界网络', role: '跨终端锚定唯一身份，连接共享世界原语' },
    ],
    blueprintBottomTierLabel: '底层 · 可随时热插拔的计算引擎',
    blueprintBottomTierNote: '模型每三个月迭代一代；随时更换底层引擎，上层记忆与应用体验毫发无损',
    blueprintSubstrates: [
      '本机 Apple Silicon / GPU 推理引擎',
      '你自选的云端多模态服务',
      '本地私有目录存储',
    ],
    legacyCaption: '传统应用中心主义：上层记忆彼此封锁，底层本地模型却挤在一块显卡上互相踩踏',
    legacySilos: [
      { app: '搜索研究软件', issue1: '独自拉起一套推理进程', issue2: '上下文锁在当前标签页' },
      { app: '音视频创作软件', issue1: '并发霸占显卡与大块显存', issue2: '无法复用已有素材偏好' },
      { app: '日常笔记工具', issue1: '重复驻留向量与模型环境', issue2: '换个软件完全不认识你' },
      { app: '网页聊天窗口', issue1: '单独配密钥、记忆留云端', issue2: '离开浏览器即刻断线' },
    ],
    legacySummary: '当推理进程与记忆依附于单一软件，不仅切窗失忆，未来 AI 应用越多，本地算力争抢与崩溃就越无解。',
    matrixEyebrow: '01 · 全感官算力中枢',
    matrixTitle: '不止会打字聊天——一套基座，配齐「眼、耳、声、乐、思」20 项能力',
    matrixLead: '在 Nimi Home 配好一次本机显卡或云端模型，所有接入软件就能直接调用这 20 项感官能力——在左侧能力目录切换，即可查看动态图例与场景说明：',
    textSubFeaturesLabel: '内置多模态输入 · 推理链 · JSON · 64 路工具',
    textSubFeatures: [],
    routingPrinciples: [],
    groups: {
      text: { title: '思考与判断', countBadge: '4' },
      visual: { title: '视觉与超清', countBadge: '7' },
      audio: { title: '语音与音乐', countBadge: '8' },
      realtime: { title: '实时通话', countBadge: '1' },
    },
    capabilityGroupsLabel: '20 项全感官算力控制台',
    capabilityFiltersLabel: '点选任意能力查看实时信号预览',
    capabilitySampleSourceLab: 'Nimi Lab 实测记录',
    capabilitySampleSourceRuntime: 'Runtime 标准能力契约',
    planeBothBadge: '本机 + 云端',
    planeLocalOnlyBadge: '纯本机',
    planeCloudLiveBadge: '实时流',
    costBoundaryTitle: '基座完全免费开源',
    costBoundaryBody: '本机硬件推理零接口费，且严格锁定本地执行、绝不暗中切往云端；选用云端服务时仅按当次请求透明计费。',
    integrationsEyebrow: '02 · 零密钥暴露连接层',
    integrationsTitle: '连上微信、QQ、Telegram 与生态应用——能力通了，密钥锁在本机',
    integrationsLead: '传统插件往往要你交出原始 Bot Token 或开放全部聊天记录。Nimi 在底座内建「单向安全隔离闸门」：外部账号只在 Nimi Home 配一次，上层应用永远只拿到受控代号：',
    domainsEyebrow: '03 · 记忆、身份与智能体生命层 / Living Intelligence',
    domainsTitle: '大模型只算下一秒；真正让智能鲜活懂你的，是连续记忆、分寸与关系',
    domainsLead: '当 AI 从一次性问答走向长期陪伴与协作，底层必须解决五个核心问题。',
    domainsOwnsLabel: '负责什么',
    domainsBoundaryLabel: '安全红线',
    domains: [
      {
        id: 'runtime',
        badge: 'Apache-2.0 开源',
        title: 'Runtime · 算力与连接内核',
        summary: '常驻设备后台，将本地显卡进程租约、20 项多模态推理与外部通道代理收拢为单一调度入口。',
        owns: '统一编排 20 项能力与本地显卡进程，封存云端与 IM 凭证，告别多应用抢卡。',
        boundary: '应用不能私拉模型或读取密钥，执行平面锁死，绝不暗中切往云端。',
      },
      {
        id: 'cognition',
        badge: '开源 · 本机记忆',
        title: 'Cognition · 连续记忆引擎',
        summary: '将散落在不同应用与时间里的对话沉淀为结构化记忆，让上下文跨工具自然延续。',
        owns: '按伙伴独立沉淀可溯源的长期记忆，随时可检视、纠偏或一键彻底遗忘。',
        boundary: '记忆库落在你指定的本地目录，与各应用物理分区，未经授权绝不可读。',
      },
      {
        id: 'realm',
        badge: '互联服务',
        title: 'Realm · 身份与世界网络',
        summary: '当你跨越不同终端或步入共享故事世界时，锚定唯一身份并连接结构化世界原语。',
        owns: '统一账号认证、主设备绑定协调、社交可见性控制与公开世界目录。',
        boundary: '仅验证身份与关系，绝不会将本地模型、私聊记录或文件自动传上云端。',
      },
    ],
    openSourceBoundary: 'Runtime、Cognition、Desktop、SDK、Kit 与 App Tools 核心代码均在 GitHub 开源；Realm 互联服务由 Nimi Network Limited 维护。',
    topologyEyebrow: '04 · 连续体演进 / Today & Horizon',
    topologyTitle: '当智能真正归于个人基座，每块屏幕都只是它的窗口',
    topologyLead: '一旦算力、连接与记忆不再被锁在某个软件里，它就天然具备了跨空间流转的基因。Nimi 从今天算力最充沛的个人电脑出发，沿着清晰的现实工程步骤向外生长：',
    topologyStages: [
      {
        id: 'desktop',
        step: '现在 · 已开放下载',
        status: '公开测试版 Beta',
        title: '扎根个人电脑：你的第一台常驻 AI 主机',
        body: '现已提供 Apple Silicon Mac 与 Windows 安装包。装好一次，桌面就拥有了统一的算力池、连接网关与记忆库。',
        milestones: [
          '20 项本机引擎与云端连接器统一装配调度',
          'Nimi Home、织羽与微信/QQ/Telegram/MCP 安全贯通',
          '10 款官方应用与 13 款开源工具现已接入',
        ],
      },
      {
        id: 'remote',
        step: '下一步 · 协议已打通',
        status: '按客户端准入',
        title: '跨出书桌：独立网页与移动终端安全回连',
        body: '不经过第三方聊天中转云——经你在桌面端确认授权后，受准入的远程客户端可直接连回你的主电脑基座。',
        milestones: [
          '精确来源校验与桌面宿主确认机制已就绪',
          '在外也能直接复用家里电脑的显卡算力与本地记忆',
          '注：独立手机端尚未上架商店，nimi.ai 官网不承载聊天',
        ],
      },
      {
        id: 'roadmap',
        step: '远方 · 开放协议边界',
        status: '长期架构方向',
        title: '走向泛在空间：常驻家庭节点与环境终端',
        body: '同一套轻量化、开放式的 Runtime 与记忆协议，正持续向全天静音运行的家庭迷你主机与更多日常空间终端延伸。',
        milestones: [
          '面向家庭常驻个人算力节点的轻量化演进',
          '工作、创作、生活与娱乐在同一记忆脉络上自然流转',
          '终端形态随时代更迭，背后的同一个智能始终归你',
        ],
      },
    ],
    trustEyebrow: '05 · 主权契约 / Sovereign by Design',
    trustTitle: '越深入日常的个人基座，控制权就越不能让渡分毫',
    trustLead: '一个能长期承载你工作脉络与生活记忆的基座，绝不能是一座别人的云端黑盒。Nimi 从底层协议上确立了四条不可逾越的边界：',
    dataRoot: {
      title: '存储目录由你亲手指定',
      body: '首次启动由你在本机自选数据根目录；不以预装庞大模型作为启动门槛，登录选定目录即可直接进入。',
    },
    permissions: {
      title: '应用权限先声明、后放行',
      body: '每款接入应用都只运行在各自的隔离存储区内，调用算力、记忆或外部连接必须声明在案，越界请求一律默认拒绝。',
    },
    resilience: {
      title: '在线可远程管控，断网照常运转',
      body: '随时在官网账号中心查看或暂停已绑定的主 Runtime；即便外部网络中断，本地模型与常驻伙伴依然照常工作。',
      link: '前往账号与主机中心',
    },
    signing: {
      title: '核心开源可审，发布签名可验',
      body: '底座核心仓库公开透明；公开 Beta 更新清单支持 Ed25519 签名校验，并完整公示各平台安装包 SHA-256 摘要。',
      link: '代码签名与校验政策',
    },
  },
  en: {
    metaTitle: 'Platform: The Personal AI Foundation Beneath Every Screen | Nimi',
    metaDescription: 'Unify 20 full-sensory AI capabilities, zero-exposure integrations, compounding memory, and cross-device identity into one personal foundation you own.',
    eyebrow: 'Nimi Platform · Personal Compute, Integration & Memory Foundation',
    title: 'Free AI from isolated apps. Make it the personal foundation beneath every screen',
    lead: 'Today’s AI is built upside-down: every app walls off your context, asks for raw tokens, and spawns its own local model server that fights sibling apps for the same GPU and VRAM. Nimi inverts the stack—sinking unified model scheduling, zero-exposure connections, and continuous memory into one persistent foundation.',
    downloadCta: 'Download Desktop Beta',
    roadmapCta: 'See What Runs Today & Next',
    sourceCta: 'Open Source on GitHub',
    specCta: 'Protocol Specification',
    blueprintSwitchLabel: 'Compare architectural paradigms',
    blueprintModeNimi: 'Nimi Stack: Personal Core',
    blueprintModeLegacy: 'Status Quo: App Silos',
    blueprintTopTierLabel: 'Top Layer · Lightweight Apps & Device Viewports',
    blueprintTopTierNote: 'Zero bundled model bloat or trapped context—plug in and switch surfaces without friction',
    blueprintSurfaces: [
      { name: 'Nimi Home Hub', tag: 'Live Today' },
      { name: '23 Curated Apps', tag: 'Live Today' },
      { name: 'Voiced Companions', tag: 'Live Today' },
      { name: 'Admitted Web & Mobile', tag: 'Protocol Ready' },
      { name: 'Home Nodes & Ambient Endpoints', tag: 'Expanding', isFuture: true },
    ],
    blueprintCoreLabel: 'Middle Layer · Your Persistent Personal Core',
    blueprintCoreTitle: 'Compute routing, compounding memory, and identity converge here—apps and screens change, the core stays yours',
    blueprintCorePillars: [
      { name: 'Runtime · Compute & Integration Kernel', role: 'Unifies 20 AI capabilities & zero-exposure connectors' },
      { name: 'Cognition · Memory Kernel', role: 'Compounds inspectable, editable local context across apps' },
      { name: 'Realm · Identity & World Network', role: 'Anchors cross-device identity & shared world primitives' },
    ],
    blueprintBottomTierLabel: 'Bottom Layer · Hot-Swappable Compute Substrates',
    blueprintBottomTierNote: 'Models turn over every quarter; swap engines anytime while your memory and apps stay intact',
    blueprintSubstrates: [
      'Local Apple silicon / GPU engines',
      'User-chosen cloud model connectors',
      'User-selected local storage directory',
    ],
    legacyCaption: 'App-Centric Status Quo: Memories walled off above, uncoordinated local models fighting over one GPU below',
    legacySilos: [
      { app: 'Research App', issue1: 'Spawns private model process', issue2: 'Context trapped in one tab' },
      { app: 'Media Studio', issue1: 'Hogs GPU & VRAM concurrently', issue2: 'Zero shared preferences' },
      { app: 'Notes Tool', issue1: 'Duplicates local embed runtime', issue2: 'Starts from scratch every time' },
      { app: 'Web Chat Tab', issue1: 'Separate key & cloud lock-in', issue2: 'Vanishes when you switch tools' },
    ],
    legacySummary: 'As AI apps multiply on your machine, uncoordinated local model processes turn into constant VRAM crashes and stalls.',
    matrixEyebrow: '01 · Full-Sensory Compute Hub',
    matrixTitle: 'Far beyond a chat box—20 senses across vision, voice, music, and decisions',
    matrixLead: 'Configure your local GPU or cloud models once in Nimi Home, and every app gains all 20 capabilities out of the box. Browse the left capability menu to inspect live diagrams and details:',
    textSubFeaturesLabel: 'Multimodal input · Reasoning · Strict JSON · 64 tools',
    textSubFeatures: [],
    routingPrinciples: [],
    groups: {
      text: { title: 'Think & Decide', countBadge: '4' },
      visual: { title: 'Vision & 4K', countBadge: '7' },
      audio: { title: 'Voice & Music', countBadge: '8' },
      realtime: { title: 'Live Call', countBadge: '1' },
    },
    capabilityGroupsLabel: '20-capability sensory console',
    capabilityFiltersLabel: 'Select any capability to preview live signals',
    capabilitySampleSourceLab: 'Nimi Lab recorded sample',
    capabilitySampleSourceRuntime: 'Runtime capability contract',
    planeBothBadge: 'Local + Cloud',
    planeLocalOnlyBadge: 'Local only',
    planeCloudLiveBadge: 'Live stream',
    costBoundaryTitle: 'Free & open-source foundation',
    costBoundaryBody: 'Local GPU inference runs at zero API cost and stays strictly locked to your device; optional cloud services bill transparently per request.',
    integrationsEyebrow: '02 · Zero-Exposure Connections',
    integrationsTitle: 'Connect WeChat, QQ, Telegram, MCP, and Nimi Apps—while secrets stay locked on your PC',
    integrationsLead: 'Ordinary bot plugins ask for raw tokens or full chat archives. Nimi puts a one-way Security Gate inside Runtime: pair your accounts once in Nimi Home, and apps only ever touch revocable opaque handles:',
    domainsEyebrow: '03 · Memory, Identity & Agent Life / Living Intelligence',
    domainsTitle: 'Models only compute the next second. Memory, boundaries, and relationships make AI alive',
    domainsLead: 'Moving AI from a disposable chat box to a lasting companion takes five core capabilities.',
    domainsOwnsLabel: 'What it owns',
    domainsBoundaryLabel: 'Hard boundary',
    domains: [
      {
        id: 'runtime',
        badge: 'Apache-2.0',
        title: 'Runtime · Compute & Broker',
        summary: 'Runs on your machine as a single scheduler for local GPU model leases, 20 AI capabilities, and external channels.',
        owns: 'Schedules 20 capabilities and local GPU leases, seals cloud & IM tokens, and ends GPU contention.',
        boundary: 'Apps never spawn rival servers or read raw tokens; execution planes stay locked with zero silent fallback.',
      },
      {
        id: 'cognition',
        badge: 'Open Source',
        title: 'Cognition · Local Memory Kernel',
        summary: 'Turns scattered interactions into structured, inspectable local memory that carries across tools.',
        owns: 'Tracks exact provenance per companion so you can inspect, refine, or permanently forget anytime.',
        boundary: 'Lives in your chosen local folder, physically partitioned from each app’s private data.',
      },
      {
        id: 'realm',
        badge: 'Managed Service',
        title: 'Realm · Identity & World Network',
        summary: 'Anchors one consistent identity across endpoints while connecting shared worlds and character sources.',
        owns: 'Unified authentication, primary host binding, friend visibility, and public world/app catalogs.',
        boundary: 'Verifies identity only—never auto-uploads local models, private chats, or local files.',
      },
    ],
    openSourceBoundary: 'Runtime, Cognition, Desktop, SDK, Kit, and App Tools are open source on GitHub. Nimi Network Limited operates the Realm network.',
    topologyEyebrow: '04 · Surface Continuum / Today & Horizon',
    topologyTitle: 'Once intelligence belongs to your foundation, every screen is just a viewport',
    topologyLead: 'Decoupling compute, integrations, and memory from individual apps gives intelligence a natural path across devices—starting from the personal computer on your desk today:',
    topologyStages: [
      {
        id: 'desktop',
        step: 'Now · Available Today',
        status: 'Public Beta',
        title: 'Anchored on your PC: your first personal AI host',
        body: 'Installers for Apple silicon Macs and Windows PCs are live today—turning your computer into one shared compute, integration, and memory hub.',
        milestones: [
          '20 capabilities orchestrated across local GPUs and cloud connectors',
          'Zero-exposure links to WeChat, QQ, Telegram, Feishu, and MCP',
          '10 Official apps and 13 adapted open-source tools ready to explore',
        ],
      },
      {
        id: 'remote',
        step: 'Next · Protocol Ready',
        status: 'Admitted per client',
        title: 'Beyond the desk: direct web and mobile links back home',
        body: 'No third-party chat relay cloud: after one-time desktop confirmation, admitted remote clients connect directly back to your PC host.',
        milestones: [
          'Exact origin verification and owner-witnessed host pairing',
          'Reach your home GPU and local memory from authorized endpoints',
          'Note: standalone mobile apps are not yet in stores; nimi.ai hosts no chat',
        ],
      },
      {
        id: 'roadmap',
        step: 'Horizon · Open Trajectory',
        status: 'Long-Term Direction',
        title: 'Ambient endpoints: silent home nodes and everyday spaces',
        body: 'Extending the same open Runtime and memory protocol toward always-on home mini-nodes and future ambient endpoints across work, life, and play.',
        milestones: [
          'Whisper-quiet always-on personal compute nodes at home',
          'Continuous context flowing across work, creation, and leisure',
          'Endpoints evolve over time—the underlying intelligence stays yours',
        ],
      },
    ],
    trustEyebrow: '05 · Sovereign Bedrock / Verifiable Trust',
    trustTitle: 'The deeper a foundation sits in your life, the more ownership matters',
    trustLead: 'Infrastructure that holds your long-term context cannot be an opaque corporate vault. Four structural guarantees keep you in command:',
    dataRoot: {
      title: 'User-chosen local data root',
      body: 'Select your own local storage folder on first launch—and enter immediately without mandatory model downloads.',
    },
    permissions: {
      title: 'Declared, isolated app access',
      body: 'Every app runs in its own storage partition and declares required scopes up front; undeclared calls fail closed.',
    },
    resilience: {
      title: 'Online host control & offline resilience',
      body: 'Inspect or pause your linked host from the Account Center anytime—and keep using local AI and companions offline.',
      link: 'Open Account & Host Center',
    },
    signing: {
      title: 'Open-core code & signed releases',
      body: 'Audit the open-source core on GitHub and verify Beta update manifests with Ed25519 signatures and SHA-256 digests.',
      link: 'Code Signing & Verification Policy',
    },
  },
};

export function PlatformPage() {
  const [locale, setLocale] = usePublicPageLocale();
  const [selectedCapability, setSelectedCapability] = useState<CapabilityId>('text.generate');
  const labMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = labMenuRef.current;
    if (!container) return;
    const activeBtn = container.querySelector<HTMLButtonElement>(`button[data-capability="${selectedCapability}"]`);
    if (!activeBtn) return;
    const btnTop = activeBtn.offsetTop;
    const btnBottom = btnTop + activeBtn.offsetHeight;
    if (btnTop < container.scrollTop) {
      container.scrollTop = Math.max(0, btnTop - 16);
    } else if (btnBottom > container.scrollTop + container.clientHeight) {
      container.scrollTop = btnBottom - container.clientHeight + 16;
    }
  }, [selectedCapability]);
  const copy = PLATFORM_COPY[locale];
  const capLabels = PLATFORM_CAPABILITY_LABELS[locale];
  const links = useResolvedPublicLinks(locale);

  usePublicDocumentMetadata(copy.metaTitle, copy.metaDescription, '/platform', locale);

  const capabilityStats = useMemo(() => {
    return ACTIVE_CAPABILITIES.map(({ id, group }) => {
      const sample = CAPABILITY_SAMPLES[id];
      return {
        id,
        group,
        label: capLabels[id] ?? id,
        tagline: sample.tagline[locale],
        sampleKind: sample.sampleKind,
      };
    });
  }, [capLabels, locale]);

  const selectedItem = capabilityStats.find((item) => item.id === selectedCapability)!;

  return (
    <PublicSiteShell
      locale={locale}
      onLocaleChange={setLocale}
      activePath="/platform"
      shellClassName="public-platform-page"
    >
      {/* Prologue: The Stack Inversion Thesis + 2.5D Interactive Simulation Stage */}
      <section className="public-hero-section public-platform-hero">
        <div className="story-container">
          <div className="public-hero-header public-platform-vision-header">
            <span className="public-eyebrow">{copy.eyebrow}</span>
            <h1>{copy.title}</h1>
            <p className="public-hero-lead">{copy.lead}</p>
            <div className="public-hero-actions">
              <Link to={links.downloadUrl} className="story-button">
                <span>{copy.downloadCta}</span>
              </Link>
              <a href="#topology" className="story-button story-button-outline">
                <span>{copy.roadmapCta}</span>
              </a>
              <div className="public-platform-reference-links">
                <a href={links.githubUrl} className="story-link">
                  <span>{copy.sourceCta}</span>
                  <ArrowUpRight size={16} aria-hidden="true" />
                </a>
                <a href="https://github.com/nimiplatform/nimi/tree/main/.nimi/spec" className="story-link">
                  <span>{copy.specCta}</span>
                  <ArrowUpRight size={16} aria-hidden="true" />
                </a>
              </div>
            </div>
          </div>

          <PlatformStackStage locale={locale} copy={copy} />
        </div>
      </section>

      {/* Chapter 01: Full-Sensory 20-Capability Panoramic Matrix + Live Router & Telemetry */}
      <section id="capabilities" className="public-page-section public-section-tinted public-capabilities-section" aria-labelledby="capabilities-heading">
        <div className="story-container">
          <header className="story-heading public-section-heading-wide">
            <span className="story-eyebrow">{copy.matrixEyebrow}</span>
            <h2 id="capabilities-heading">{copy.matrixTitle}</h2>
            <p>{copy.matrixLead}</p>
          </header>

          {/* Nimi Lab Layout: Narrow Left Capability Sidebar (232px) + Right Top Diagram & Bottom Explanation */}
          <div className="platform-capability-atlas platform-sensory-console" role="region" aria-label={copy.capabilityGroupsLabel} data-group={selectedItem.group}>
            <aside className="platform-lab-sidebar" aria-label={copy.capabilityFiltersLabel}>
              <div className="platform-lab-sidebar-head">
                <span className="platform-lab-traffic" aria-hidden="true">
                  <i /><i /><i />
                </span>
                <strong>{locale === 'zh' ? 'Nimi Lab · 能力目录' : 'Nimi Lab · Capabilities'}</strong>
                <code>20</code>
              </div>

              <div className="platform-lab-sidebar-scroll" ref={labMenuRef} role="group" aria-label={copy.capabilityFiltersLabel}>
                {CAPABILITY_GROUPS.map((group) => {
                  const domainItems = capabilityStats.filter((item) => item.group === group);
                  return (
                    <div key={group} className="platform-lab-menu-group">
                      <p className="platform-lab-group-label">{copy.groups[group].title}</p>
                      <div className="platform-lab-menu-list">
                        {domainItems.map((item) => {
                          const Icon = SAMPLE_ICONS[item.id];
                          const isSelected = item.id === selectedCapability;
                          return (
                            <button
                              key={item.id}
                              type="button"
                              data-capability={item.id}
                              className={isSelected ? 'is-active' : undefined}
                              aria-pressed={isSelected}
                              aria-controls="platform-capability-sample"
                              onClick={() => setSelectedCapability(item.id)}
                            >
                              <Icon size={14} aria-hidden="true" />
                              <span>{item.label}</span>
                              <i className="platform-lab-row-dot" aria-hidden="true" />
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="platform-lab-sidebar-foot">
                <small>{copy.textSubFeaturesLabel}</small>
              </div>
            </aside>

            <section className="platform-lab-main" id="platform-capability-sample" aria-labelledby="capability-sample-heading">
              <PlatformCapabilityPreview
                key={selectedItem.id}
                capability={selectedItem.id}
                locale={locale}
                title={selectedItem.label}
                headingId="capability-sample-heading"
                routeCounts={(
                  <PlatformCapabilityRouteCounts capability={selectedItem.id} locale={locale} />
                )}
              />
            </section>
          </div>

          <p className="platform-cost-footnote">
            <ShieldCheck size={15} aria-hidden="true" />
            <span>
              <strong>{copy.costBoundaryTitle}：</strong>
              {copy.costBoundaryBody}
            </span>
          </p>
        </div>
      </section>

      {/* Chapter 02: Zero-Exposure Integration Broker & Ecosystem Interop */}
      <section id="integrations" className="public-page-section public-platform-integrations-section" aria-labelledby="platform-integrations-heading">
        <div className="story-container">
          <header className="story-heading public-section-heading-wide">
            <span className="story-eyebrow">{copy.integrationsEyebrow}</span>
            <h2 id="platform-integrations-heading">{copy.integrationsTitle}</h2>
            <p>{copy.integrationsLead}</p>
          </header>

          <PlatformIntegrationsSection locale={locale} />
        </div>
      </section>

      {/* Chapter 03: Memory & Identity — Interactive Three-Domain Flow & Hard Isolation */}
      <section id="domains" className="public-page-section public-section-tinted" aria-labelledby="domains-heading">
        <div className="story-container">
          <header className="story-heading public-section-heading-wide">
            <span className="story-eyebrow">{copy.domainsEyebrow}</span>
            <h2 id="domains-heading">{copy.domainsTitle}</h2>
            <p>{copy.domainsLead}</p>
          </header>

          <PlatformMemoryIdentitySection
            locale={locale}
            domains={copy.domains}
            ownsLabel={copy.domainsOwnsLabel}
            boundaryLabel={copy.domainsBoundaryLabel}
          />

          <p className="public-platform-source-note">{copy.openSourceBoundary}</p>
        </div>
      </section>

      {/* Chapter 04: Continuum Across Surfaces — Spatial Viewport Projection Hub */}
      <section id="topology" className="public-page-section" aria-labelledby="topology-heading">
        <div className="story-container">
          <header className="story-heading public-section-heading-wide">
            <span className="story-eyebrow">{copy.topologyEyebrow}</span>
            <h2 id="topology-heading">{copy.topologyTitle}</h2>
            <p>{copy.topologyLead}</p>
          </header>

          <PlatformContinuumSection locale={locale} stages={copy.topologyStages} />
        </div>
      </section>

      {/* Chapter 05: Sovereign Bedrock Interactive Console */}
      <section id="trust" className="public-page-section public-section-tinted" aria-labelledby="trust-heading">
        <div className="story-container">
          <header className="story-heading public-section-heading-wide">
            <span className="story-eyebrow">{copy.trustEyebrow}</span>
            <h2 id="trust-heading">{copy.trustTitle}</h2>
            <p>{copy.trustLead}</p>
          </header>

          <PlatformSovereignConsole
            locale={locale}
            dataRoot={copy.dataRoot}
            permissions={copy.permissions}
            resilience={copy.resilience}
            signing={copy.signing}
          />
        </div>
      </section>
    </PublicSiteShell>
  );
}
