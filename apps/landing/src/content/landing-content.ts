import type { LandingLocale } from '../i18n/locale.js';

export type LandingContent = {
  localeName: string;
  skipToContent: string;
  nav: {
    builders: string;
    users: string;
    protocol: string;
    security: string;
    quickstart: string;
  };
  hero: {
    eyebrow: string;
    title: string;
    subtitle: string;
    description: string;
    builderCta: string;
    userCta: string;
    docsCta: string;
    trust: string;
  };
  why: {
    title: string;
    subtitle: string;
    buildersTitle: string;
    usersTitle: string;
    builders: Array<{ title: string; description: string }>;
    users: Array<{ title: string; description: string }>;
  };
  stack: {
    title: string;
    subtitle: string;
    items: Array<{
      name: string;
      role: string;
      points: string[];
    }>;
  };
  protocol: {
    title: string;
    subtitle: string;
    items: Array<{
      name: string;
      summary: string;
      guarantee: string;
    }>;
  };
  security: {
    title: string;
    subtitle: string;
    safeguardsTitle: string;
    governanceTitle: string;
    safeguards: string[];
    governance: string[];
  };
  quickstart: {
    title: string;
    subtitle: string;
    commandsLabel: string;
    commands: string[];
    sdkLabel: string;
    sdkSnippet: string;
    docsCta: string;
    protocolCta: string;
  };
  journey: {
    title: string;
    subtitle: string;
    steps: Array<{
      title: string;
      description: string;
    }>;
  };
  openSource: {
    title: string;
    subtitle: string;
    columns: {
      component: string;
      path: string;
      license: string;
      mode: string;
    };
    rows: Array<{
      component: string;
      path: string;
      license: string;
      mode: string;
    }>;
    note: string;
  };
  finalCta: {
    title: string;
    description: string;
    builderCta: string;
    userCta: string;
    githubCta: string;
  };
  footer: {
    line1: string;
    line2: string;
  };
  localeToggleLabel: string;
  localeOptions: {
    en: string;
    zh: string;
  };
};

const EN_SDK_SNIPPET = `import { Runtime } from '@nimiplatform/sdk';

const runtime = new Runtime({
  appId: 'my_app',
  transport: { type: 'node-grpc', endpoint: '127.0.0.1:46371' },
});

const result = await runtime.ai.text.generate({
  model: 'local/qwen2.5',
  subjectUserId: 'local-user',
  input: 'Hello from Nimi!',
  route: 'local-runtime',
  fallback: 'deny',
  timeoutMs: 30000,
});

console.log(result.text);`;

const ZH_SDK_SNIPPET = `import { Runtime } from '@nimiplatform/sdk';

const runtime = new Runtime({
  appId: 'my_app',
  transport: { type: 'node-grpc', endpoint: '127.0.0.1:46371' },
});

const result = await runtime.ai.text.generate({
  model: 'local/qwen2.5',
  subjectUserId: 'local-user',
  input: '你好，Nimi！',
  route: 'local-runtime',
  fallback: 'deny',
  timeoutMs: 30000,
});

console.log(result.text);`;

export const LANDING_CONTENT: Record<LandingLocale, LandingContent> = {
  en: {
    localeName: 'English',
    skipToContent: 'Skip to main content',
    nav: {
      builders: 'For Builders',
      users: 'For Users',
      protocol: 'Protocol',
      security: 'Security',
      quickstart: 'Quickstart',
    },
    hero: {
      eyebrow: 'AI-Native Open World Platform',
      title: 'Build persistent AI worlds that users can actually live in.',
      subtitle: 'Runtime + Realm + Unified SDK',
      description: 'Nimi combines a local execution Runtime, a cloud semantic Realm, and one SDK surface for apps, worlds, and agents.',
      builderCta: 'Start Building',
      userCta: 'Enter Nimi',
      docsCta: 'Read Docs',
      trust: 'Spec-first contracts, auditable actions, and open-source core components.',
    },
    why: {
      title: 'Why Nimi',
      subtitle: 'One platform, two perspectives, zero semantic drift.',
      buildersTitle: 'For Developers',
      usersTitle: 'For Users',
      builders: [
        {
          title: 'One SDK, stable app code',
          description: 'Use @nimiplatform/sdk to access Runtime and Realm without rewriting for each provider or transport.',
        },
        {
          title: 'Local-first execution',
          description: 'Run sensitive AI work in local Runtime and move to cloud only when your use case requires it.',
        },
        {
          title: 'Spec-first engineering',
          description: 'Contracts are explicit in spec/*, reducing ambiguity across runtime, sdk, desktop, and web.',
        },
      ],
      users: [
        {
          title: 'Unified identity across worlds',
          description: 'Your account and authorization context carry across Nimi apps and world surfaces.',
        },
        {
          title: 'Agents with continuity',
          description: 'Agents retain memory and relationship context instead of resetting in every app.',
        },
        {
          title: 'Cross-world interoperability',
          description: 'Transit, social, and context semantics are governed by one protocol contract.',
        },
      ],
    },
    stack: {
      title: 'Core Stack',
      subtitle: 'Each layer owns a clear boundary, and the SDK keeps integration uniform.',
      items: [
        {
          name: 'Runtime',
          role: 'Local execution daemon (Go + gRPC)',
          points: [
            'Model routing for local-runtime and token-api paths',
            'Inference, workflow, knowledge indexing, and audit events',
            'Deterministic error model and provider capability contracts',
          ],
        },
        {
          name: 'Realm',
          role: 'Cloud semantic state layer',
          points: [
            'Identity, social graph, economy, worlds, agents, and memory',
            'REST + WebSocket interfaces surfaced via SDK',
            'Semantic sovereignty of six protocol primitives',
          ],
        },
        {
          name: 'Unified SDK',
          role: '@nimiplatform/sdk integration surface',
          points: [
            'Runtime + Realm clients under one package boundary',
            'Explicit transport and error projection contracts',
            'Stable public interfaces for apps, desktop, and mods',
          ],
        },
      ],
    },
    protocol: {
      title: 'Six Protocol Primitives',
      subtitle: 'Interoperability is contract-driven, not best-effort conventions.',
      items: [
        {
          name: 'Timeflow',
          summary: 'Controls world time ratio, ticks, and replay consistency.',
          guarantee: 'World time must remain monotonic and auditable.',
        },
        {
          name: 'Social',
          summary: 'Defines relationship types, preconditions, and decay rules.',
          guarantee: 'Access decisions must be explainable and replayable.',
        },
        {
          name: 'Economy',
          summary: 'Governs transfer mode, settlement windows, and inflation policy.',
          guarantee: 'Value flow must preserve conservation constraints.',
        },
        {
          name: 'Transit',
          summary: 'Manages cross-world ingress quotas and carry policies.',
          guarantee: 'Every rejection returns an actionable hint.',
        },
        {
          name: 'Context',
          summary: 'Defines context scope, retention TTL, and truncation policy.',
          guarantee: 'Context injection order remains stable and observable.',
        },
        {
          name: 'Presence',
          summary: 'Tracks state heartbeat, TTL, and device merge policy.',
          guarantee: 'Expired state converges automatically.',
        },
      ],
    },
    security: {
      title: 'Security & Governance by Design',
      subtitle: 'No fake-human automation shortcuts. Explicit machine interfaces with auditable decisions.',
      safeguardsTitle: 'Security Safeguards',
      governanceTitle: 'Open Governance Guardrails',
      safeguards: [
        'Least-privilege grants with revocable delegation boundaries',
        'Fail-close behavior for high-risk writes and uncertain auth paths',
        'Deterministic reason codes and trace identifiers across the stack',
      ],
      governance: [
        'Open-source core: runtime, sdk, desktop, web, proto, docs',
        'Contract and drift checks enforced in CI gates',
        'License matrix and release checks as first-class quality bars',
      ],
    },
    quickstart: {
      title: 'Developer Quickstart',
      subtitle: 'Get from zero to first AI call in minutes.',
      commandsLabel: 'Terminal Path',
      commands: [
        'pnpm install',
        'pnpm runtime:serve',
        'pnpm runtime:health',
        'pnpm runtime:run:hello',
      ],
      sdkLabel: 'SDK Path',
      sdkSnippet: EN_SDK_SNIPPET,
      docsCta: 'Open Getting Started',
      protocolCta: 'Read Protocol Contract',
    },
    journey: {
      title: 'User Journey',
      subtitle: 'From discovery to persistent AI relationships.',
      steps: [
        {
          title: 'Discover Worlds',
          description: 'Explore public worlds, agents, and social signals through one identity layer.',
        },
        {
          title: 'Interact with Humans and Agents',
          description: 'Build relationships that span humans, world-owned agents, and master-owned agents.',
        },
        {
          title: 'Carry Context Forward',
          description: 'Move across apps and worlds while preserving continuity in context, presence, and memory.',
        },
      ],
    },
    openSource: {
      title: 'Open Source Boundaries',
      subtitle: 'Clear component boundaries reduce confusion and integration risk.',
      columns: {
        component: 'Component',
        path: 'Path',
        license: 'License',
        mode: 'Mode',
      },
      rows: [
        {
          component: 'nimi-runtime',
          path: 'runtime/',
          license: 'Apache-2.0',
          mode: 'Open source',
        },
        {
          component: '@nimiplatform/sdk',
          path: 'sdk/',
          license: 'Apache-2.0',
          mode: 'Open source',
        },
        {
          component: 'desktop / web / docs',
          path: 'apps/*, docs/',
          license: 'MIT / CC-BY-4.0',
          mode: 'Open source',
        },
        {
          component: 'Realm service',
          path: 'managed cloud layer',
          license: 'N/A',
          mode: 'Managed service',
        },
      ],
      note: 'Realm semantics are public through SDK and protocol contracts, while service internals stay managed.',
    },
    finalCta: {
      title: 'Build for continuity. Design for trust.',
      description: 'Whether you are shipping a new AI app or exploring persistent worlds, Nimi gives you contract-level foundations.',
      builderCta: 'Build with Nimi',
      userCta: 'Open Nimi App',
      githubCta: 'View on GitHub',
    },
    footer: {
      line1: 'Nimi Platform: Runtime + Realm + Unified SDK',
      line2: 'Licenses: Apache-2.0 (runtime/sdk/proto), MIT (apps), CC-BY-4.0 (docs)',
    },
    localeToggleLabel: 'Language',
    localeOptions: {
      en: 'EN',
      zh: '中',
    },
  },
  zh: {
    localeName: '简体中文',
    skipToContent: '跳转到主要内容',
    nav: {
      builders: '开发者',
      users: '用户',
      protocol: '协议原语',
      security: '安全治理',
      quickstart: '快速开始',
    },
    hero: {
      eyebrow: 'AI 原生开放世界平台',
      title: '构建可持续演化、可长期居住的 AI 世界。',
      subtitle: 'Runtime + Realm + Unified SDK',
      description: 'Nimi 将本地执行 Runtime、云端语义层 Realm 与统一 SDK 组合为一条清晰的开发与体验主线。',
      builderCta: 'Start Building',
      userCta: 'Enter Nimi',
      docsCta: '查看文档',
      trust: '以 spec 合同为先，以审计链路为底，以开源核心为基础。',
    },
    why: {
      title: '为什么是 Nimi',
      subtitle: '一个平台，同时服务开发者与用户，并保持语义一致。',
      buildersTitle: '面向开发者',
      usersTitle: '面向用户',
      builders: [
        {
          title: '一个 SDK，稳定集成面',
          description: '通过 @nimiplatform/sdk 同时接入 Runtime 与 Realm，不因 provider 或传输变化反复重写业务代码。',
        },
        {
          title: '本地优先执行',
          description: '敏感与关键 AI 任务优先在本地 Runtime 处理，必要时再走云端路径。',
        },
        {
          title: 'Spec-first 工程体系',
          description: '契约在 spec/* 明确可查，降低 runtime、sdk、desktop、web 之间的协作歧义。',
        },
      ],
      users: [
        {
          title: '跨世界统一身份',
          description: '账户与授权语义可跨 Nimi 应用与世界表面复用。',
        },
        {
          title: 'Agent 的连续性',
          description: 'Agent 可保留记忆与关系上下文，不在每个应用里重新归零。',
        },
        {
          title: '跨世界互操作',
          description: 'Transit、Social、Context 等关键语义由统一协议约束。',
        },
      ],
    },
    stack: {
      title: '核心技术栈',
      subtitle: '每一层都有明确职责边界，SDK 统一接入体验。',
      items: [
        {
          name: 'Runtime',
          role: '本地执行守护进程（Go + gRPC）',
          points: [
            '统一 local-runtime 与 token-api 的路由策略',
            '覆盖推理、工作流、知识索引与审计事件',
            '错误模型与 provider 能力受契约约束',
          ],
        },
        {
          name: 'Realm',
          role: '云端语义状态层',
          points: [
            '统一管理 identity、social、economy、world、agent、memory',
            '通过 SDK 暴露 REST + WebSocket 能力',
            '六原语语义主权固定在 Realm',
          ],
        },
        {
          name: 'Unified SDK',
          role: '@nimiplatform/sdk 统一开发入口',
          points: [
            '在同一包边界下覆盖 Runtime 与 Realm 客户端',
            '显式传输层约束与错误投影语义',
            '为 app、desktop、mods 提供稳定接口',
          ],
        },
      ],
    },
    protocol: {
      title: '六个协议原语',
      subtitle: '互操作来自合同，不来自经验性约定。',
      items: [
        {
          name: 'Timeflow',
          summary: '约束世界时间倍率、时钟节拍与回放一致性。',
          guarantee: '世界时间必须单调且可审计。',
        },
        {
          name: 'Social',
          summary: '定义关系类型、准入前置与衰减规则。',
          guarantee: '拒绝必须可解释，关系演化必须可回放。',
        },
        {
          name: 'Economy',
          summary: '定义转移模式、结算窗口与通胀策略。',
          guarantee: '价值流必须满足守恒约束。',
        },
        {
          name: 'Transit',
          summary: '管理跨世界准入配额与携带策略。',
          guarantee: '任意拒绝必须给出可执行 actionHint。',
        },
        {
          name: 'Context',
          summary: '定义上下文作用域、保留时长与裁剪策略。',
          guarantee: '注入顺序稳定，裁剪过程可观测。',
        },
        {
          name: 'Presence',
          summary: '约束在线状态心跳、过期与多设备合并策略。',
          guarantee: '过期状态必须自动收敛。',
        },
      ],
    },
    security: {
      title: '安全与治理内建',
      subtitle: '拒绝“伪人类点击自动化”，采用可审计的机器接口调用。',
      safeguardsTitle: '安全机制',
      governanceTitle: '开源治理边界',
      safeguards: [
        '最小权限授权与可撤销的委托链路',
        '高风险写入场景默认 fail-close',
        '全链路 reason code 与 trace 标识可追溯',
      ],
      governance: [
        'runtime、sdk、desktop、web、proto、docs 均开源',
        '契约一致性与文档漂移由 CI 强制门禁',
        'License 矩阵与发布检查作为工程质量基线',
      ],
    },
    quickstart: {
      title: '开发者快速开始',
      subtitle: '几分钟内完成从安装到首个 AI 调用。',
      commandsLabel: '命令路径',
      commands: [
        'pnpm install',
        'pnpm runtime:serve',
        'pnpm runtime:health',
        'pnpm runtime:run:hello',
      ],
      sdkLabel: 'SDK 路径',
      sdkSnippet: ZH_SDK_SNIPPET,
      docsCta: '打开入门文档',
      protocolCta: '查看协议契约',
    },
    journey: {
      title: '用户旅程',
      subtitle: '从发现世界到形成持续关系。',
      steps: [
        {
          title: '发现世界',
          description: '通过统一身份层探索公开世界、Agent 与社交信号。',
        },
        {
          title: '与人和 Agent 互动',
          description: '与真人、世界托管 Agent、用户直属 Agent 建立可持续关系。',
        },
        {
          title: '携带上下文前进',
          description: '跨应用与跨世界迁移时，保留 context、presence 与 memory 连续性。',
        },
      ],
    },
    openSource: {
      title: '开源边界一览',
      subtitle: '边界清晰，才能降低协作和集成风险。',
      columns: {
        component: '组件',
        path: '路径',
        license: '许可',
        mode: '形态',
      },
      rows: [
        {
          component: 'nimi-runtime',
          path: 'runtime/',
          license: 'Apache-2.0',
          mode: '开源',
        },
        {
          component: '@nimiplatform/sdk',
          path: 'sdk/',
          license: 'Apache-2.0',
          mode: '开源',
        },
        {
          component: 'desktop / web / docs',
          path: 'apps/*, docs/',
          license: 'MIT / CC-BY-4.0',
          mode: '开源',
        },
        {
          component: 'Realm 服务',
          path: 'managed cloud layer',
          license: 'N/A',
          mode: '托管服务',
        },
      ],
      note: 'Realm 的语义合同通过 SDK 与 protocol 对外公开，服务内部实现保持托管。',
    },
    finalCta: {
      title: '为连续性构建，为信任设计。',
      description: '无论你在做新 AI 应用，还是探索持久世界体验，Nimi 都提供可落地的契约级基础设施。',
      builderCta: '使用 Nimi 开发',
      userCta: '进入 Nimi 应用',
      githubCta: '查看 GitHub',
    },
    footer: {
      line1: 'Nimi Platform: Runtime + Realm + Unified SDK',
      line2: '许可证：Apache-2.0（runtime/sdk/proto）、MIT（apps）、CC-BY-4.0（docs）',
    },
    localeToggleLabel: '语言',
    localeOptions: {
      en: 'EN',
      zh: '中',
    },
  },
};

export function getLandingContent(locale: LandingLocale): LandingContent {
  return LANDING_CONTENT[locale];
}
