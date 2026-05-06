import type { DefaultTheme } from 'vitepress'

export const sidebarZh: DefaultTheme.Sidebar = {
  '/zh/start/': [
    {
      text: '开始',
      items: [
        { text: '从这里开始', link: '/zh/start/' },
        { text: '用户画像', link: '/zh/start/personas' },
        { text: '安装与可用性', link: '/zh/start/install' },
      ],
    },
    {
      text: '继续读',
      items: [
        { text: '平台', link: '/zh/platform/' },
        { text: 'Runtime', link: '/zh/runtime/' },
        { text: 'SDK', link: '/zh/sdk/' },
        { text: '桌面端', link: '/zh/desktop/' },
        { text: 'Realm', link: '/zh/realm/' },
        { text: 'Nimi Coding', link: '/zh/nimicoding/' },
      ],
    },
  ],

  '/zh/platform/': [
    {
      text: '平台',
      items: [
        { text: '总览', link: '/zh/platform/' },
        { text: '愿景', link: '/zh/platform/vision' },
        { text: '协议（六个基础协议）', link: '/zh/platform/protocol' },
        { text: '权威模型', link: '/zh/platform/authority-model' },
        { text: 'AI 最后一公里', link: '/zh/platform/ai-last-mile' },
        { text: '治理', link: '/zh/platform/governance' },
      ],
    },
    {
      text: '世界',
      items: [
        { text: '世界总览', link: '/zh/platform/worlds/' },
        { text: '真相、状态与历史', link: '/zh/platform/worlds/truth-state-history' },
        { text: 'OASIS', link: '/zh/platform/worlds/oasis' },
        { text: '世界生命周期', link: '/zh/platform/worlds/lifecycle' },
        { text: '世界演化引擎', link: '/zh/platform/worlds/world-evolution-engine' },
      ],
    },
    {
      text: 'Agent',
      items: [
        { text: 'Agent 总览', link: '/zh/platform/agents/' },
        { text: '四层结构', link: '/zh/platform/agents/the-four-layers' },
        { text: 'Chat 与 Life 双轨', link: '/zh/platform/agents/chat-and-life-tracks' },
        { text: '对话锚点', link: '/zh/platform/agents/conversation-anchor' },
        { text: '跨世界身份', link: '/zh/platform/agents/cross-world-identity' },
        { text: '外部 Agent', link: '/zh/platform/agents/external-agents' },
        { text: 'Hook Intent', link: '/zh/platform/agents/hook-intent' },
      ],
    },
    {
      text: '架构',
      items: [
        { text: '架构总览', link: '/zh/platform/architecture/' },
        { text: 'Realm 与 Runtime 是同侪', link: '/zh/platform/architecture/realm-runtime-siblings' },
        { text: '本地优先 + 联邦', link: '/zh/platform/architecture/local-first-with-federation' },
        { text: '跨域产品故事', link: '/zh/platform/architecture/cross-domain-product-stories' },
      ],
    },
    {
      text: '相邻权威域',
      items: [
        { text: 'Realm', link: '/zh/realm/' },
        { text: 'Avatar', link: '/zh/avatar/' },
        { text: 'Cognition', link: '/zh/cognition/' },
      ],
    },
  ],

  '/zh/runtime/': [
    {
      text: 'Runtime',
      items: [
        { text: '总览', link: '/zh/runtime/' },
        { text: 'CLI 与 Daemon', link: '/zh/runtime/cli-and-daemon' },
      ],
    },
    {
      text: 'Provider 路由',
      items: [
        { text: 'Connector 与 Provider', link: '/zh/runtime/connectors-and-providers' },
        { text: '本地 Model', link: '/zh/runtime/local-models' },
      ],
    },
    {
      text: '执行',
      items: [
        { text: 'Workflows', link: '/zh/runtime/workflows' },
        { text: '流式', link: '/zh/runtime/streaming' },
        { text: '多模态', link: '/zh/runtime/multimodal' },
      ],
    },
    {
      text: 'Agent 与记忆',
      items: [
        { text: 'Agent 执行', link: '/zh/runtime/agent-execution' },
        { text: '记忆与知识', link: '/zh/runtime/memory-and-knowledge' },
      ],
    },
    {
      text: '能力与审计',
      items: [
        { text: '委派能力', link: '/zh/runtime/delegated-capability' },
        { text: '本地审计', link: '/zh/runtime/audit-local' },
      ],
    },
    {
      text: '相关',
      items: [
        { text: 'SDK 边界', link: '/zh/sdk/boundaries' },
        { text: 'Cognition 桥', link: '/zh/cognition/' },
        { text: '错误归属', link: '/zh/reference/error-ownership' },
      ],
    },
  ],

  '/zh/sdk/': [
    {
      text: 'SDK',
      items: [
        { text: '总览', link: '/zh/sdk/' },
        { text: '边界', link: '/zh/sdk/boundaries' },
      ],
    },
    {
      text: '子路径',
      items: [
        { text: 'Runtime Client', link: '/zh/sdk/runtime-client' },
        { text: 'Realm 与世界 Client', link: '/zh/sdk/realm-world-client' },
        { text: 'AI Provider', link: '/zh/sdk/ai-provider' },
        { text: 'Scope 与 Mod', link: '/zh/sdk/scope-and-mods' },
        { text: '共享类型', link: '/zh/sdk/types' },
      ],
    },
    {
      text: '相关',
      items: [
        { text: 'Runtime', link: '/zh/runtime/' },
        { text: 'Realm', link: '/zh/realm/' },
        { text: '错误归属', link: '/zh/reference/error-ownership' },
      ],
    },
  ],

  '/zh/desktop/': [
    {
      text: '桌面端',
      items: [
        { text: '总览', link: '/zh/desktop/' },
        { text: '网页端模式', link: '/zh/desktop/web-mode' },
      ],
    },
    {
      text: '用户面',
      items: [
        { text: '聊天', link: '/zh/desktop/chat' },
        { text: '联系人与社交', link: '/zh/desktop/contacts-and-social' },
        { text: '个人主页', link: '/zh/desktop/profile' },
        { text: '经济 / 钱包', link: '/zh/desktop/economy' },
        { text: '探索与世界', link: '/zh/desktop/explore-and-worlds' },
        { text: '主页与通知', link: '/zh/desktop/home-and-notification' },
      ],
    },
    {
      text: 'Mod 与外部 AI',
      items: [
        { text: 'Mod Hub', link: '/zh/desktop/mod-hub' },
        { text: 'Mod Workspace', link: '/zh/desktop/mod-workspace' },
        { text: 'Mod 治理', link: '/zh/desktop/mods' },
        { text: '外部 Agent 接入', link: '/zh/desktop/external-agent' },
      ],
    },
    {
      text: '本地 AI',
      items: [
        { text: '本地 AI', link: '/zh/desktop/local-ai' },
      ],
    },
    {
      text: '相关',
      items: [
        { text: 'Runtime', link: '/zh/runtime/' },
        { text: 'SDK', link: '/zh/sdk/' },
        { text: 'Avatar', link: '/zh/avatar/' },
      ],
    },
  ],

  '/zh/realm/': [
    {
      text: 'Realm',
      items: [
        { text: '总览', link: '/zh/realm/' },
      ],
    },
    {
      text: '世界语义',
      items: [
        { text: '真相', link: '/zh/realm/truth' },
        { text: '世界状态', link: '/zh/realm/world-state' },
        { text: '世界历史', link: '/zh/realm/world-history' },
        { text: '读聚合面', link: '/zh/realm/projection' },
      ],
    },
    {
      text: '域表面',
      items: [
        { text: '聊天', link: '/zh/realm/chat' },
        { text: '社交与经济', link: '/zh/realm/social-and-economy' },
        { text: '资产与绑定', link: '/zh/realm/asset-and-binding' },
        { text: '通行', link: '/zh/realm/transit' },
      ],
    },
    {
      text: '创作者与 App',
      items: [
        { text: '创作者经济', link: '/zh/realm/creator-economy' },
        { text: 'App 互联', link: '/zh/realm/app-interconnect' },
      ],
    },
    {
      text: '相关',
      items: [
        { text: '平台边界', link: '/zh/platform/' },
        { text: 'SDK Realm/世界 Client', link: '/zh/sdk/realm-world-client' },
        { text: 'World 字段', link: '/zh/reference/world-fields' },
        { text: 'Spec Map', link: '/zh/reference/spec-map' },
      ],
    },
  ],

  '/zh/avatar/': [
    {
      text: 'Avatar',
      items: [
        { text: '总览', link: '/zh/avatar/' },
        { text: 'Nimi Avatar (App)', link: '/zh/avatar/nimi-avatar' },
      ],
    },
    {
      text: '形体化',
      items: [
        { text: '形体化呈现', link: '/zh/avatar/embodiment-projection' },
        { text: '载体视觉接受度', link: '/zh/avatar/carrier-acceptance' },
        { text: '后端分支', link: '/zh/avatar/backend-branches' },
      ],
    },
    {
      text: '脚本',
      items: [
        { text: 'Agent Script (NAS)', link: '/zh/avatar/agent-script' },
        { text: 'Avatar 事件', link: '/zh/avatar/avatar-events' },
      ],
    },
    {
      text: '相关',
      items: [
        { text: '平台', link: '/zh/platform/' },
        { text: '桌面端', link: '/zh/desktop/' },
        { text: 'Cognition', link: '/zh/cognition/' },
        { text: 'Agent 字段', link: '/zh/reference/agent-fields' },
      ],
    },
  ],

  '/zh/cognition/': [
    {
      text: 'Cognition',
      items: [
        { text: '总览', link: '/zh/cognition/' },
      ],
    },
    {
      text: '独立权威',
      items: [
        { text: '记忆服务', link: '/zh/cognition/memory' },
        { text: '知识服务', link: '/zh/cognition/knowledge' },
        { text: 'Prompt 服务', link: '/zh/cognition/prompt-serving' },
        { text: 'Completion', link: '/zh/cognition/completion' },
        { text: '技能服务', link: '/zh/cognition/skill-service' },
      ],
    },
    {
      text: 'Runtime 桥',
      items: [
        { text: 'Runtime 桥', link: '/zh/cognition/runtime-bridge' },
        { text: 'Runtime 升级', link: '/zh/cognition/runtime-upgrade' },
      ],
    },
    {
      text: '相关',
      items: [
        { text: 'Runtime', link: '/zh/runtime/' },
        { text: 'Avatar', link: '/zh/avatar/' },
        { text: 'Agent 字段', link: '/zh/reference/agent-fields' },
        { text: 'Spec Map', link: '/zh/reference/spec-map' },
      ],
    },
  ],

  '/zh/nimicoding/': [
    {
      text: 'Nimi Coding',
      items: [
        { text: '总览', link: '/zh/nimicoding/' },
        { text: 'Whitepaper', link: '/zh/nimicoding/whitepaper' },
      ],
    },
    {
      text: '范式',
      items: [
        { text: '范式', link: '/zh/nimicoding/the-paradigm' },
        { text: '四个闭合', link: '/zh/nimicoding/four-closures' },
        { text: '伪闭合分类', link: '/zh/nimicoding/false-closure-typology' },
        { text: '禁用捷径', link: '/zh/nimicoding/forbidden-shortcuts' },
      ],
    },
    {
      text: '角色与汇聚',
      items: [
        { text: '角色分离', link: '/zh/nimicoding/role-separation' },
        { text: '权威汇聚', link: '/zh/nimicoding/authority-convergence' },
      ],
    },
    {
      text: '生命周期',
      items: [
        { text: 'Topic 生命周期', link: '/zh/nimicoding/topic-lifecycle' },
        { text: 'Topic 工作流', link: '/zh/nimicoding/topic-workflow' },
        { text: '走查', link: '/zh/nimicoding/walkthrough' },
      ],
    },
    {
      text: '包',
      items: [
        { text: '包', link: '/zh/nimicoding/the-package' },
        { text: '宿主无关边界', link: '/zh/nimicoding/host-agnostic' },
        { text: '技能', link: '/zh/nimicoding/skills' },
        { text: 'CLI 表面', link: '/zh/nimicoding/cli' },
        { text: 'CLI 参考', link: '/zh/nimicoding/cli-reference' },
        { text: '安装', link: '/zh/nimicoding/installation' },
      ],
    },
    {
      text: '对比与采纳',
      items: [
        { text: '对比', link: '/zh/nimicoding/comparison' },
        { text: '采纳路径', link: '/zh/nimicoding/adoption-path' },
      ],
    },
    {
      text: '教程',
      items: [
        { text: '教程总览', link: '/zh/nimicoding/tutorials/' },
        { text: '第一个 Topic Bootstrap', link: '/zh/nimicoding/tutorials/first-topic' },
        { text: '第一个 Wave 端到端', link: '/zh/nimicoding/tutorials/first-wave-end-to-end' },
      ],
    },
    {
      text: 'How-to',
      items: [
        { text: 'How-to 总览', link: '/zh/nimicoding/how-to/' },
        { text: '准入一个 Wave', link: '/zh/nimicoding/how-to/admit-a-wave' },
        { text: '写 Fail-Close 不变量', link: '/zh/nimicoding/how-to/write-fail-close-invariants' },
        { text: '处理 Pending Acceptance', link: '/zh/nimicoding/how-to/handle-pending-acceptance' },
        { text: '调和分歧审计', link: '/zh/nimicoding/how-to/reconcile-divergent-audits' },
        { text: '溢出后重开', link: '/zh/nimicoding/how-to/reopen-after-overflow' },
        { text: '准入外部宿主', link: '/zh/nimicoding/how-to/admit-an-external-host' },
      ],
    },
    {
      text: '参考',
      items: [
        { text: '参考总览', link: '/zh/nimicoding/reference/' },
        { text: 'CLI 命令', link: '/zh/nimicoding/reference/cli-commands' },
        { text: 'Schema', link: '/zh/nimicoding/reference/schemas' },
        { text: '禁用捷径目录', link: '/zh/nimicoding/reference/forbidden-shortcuts-catalog' },
      ],
    },
    {
      text: '附录',
      items: [
        { text: 'oh-my-codex 适配器', link: '/zh/nimicoding/appendix/oh-my-codex' },
      ],
    },
    {
      text: '交叉参考',
      items: [
        { text: '禁用主张（docs）', link: '/zh/reference/forbidden-claims' },
        { text: '状态机', link: '/zh/reference/state-machines' },
        { text: '权威域', link: '/zh/reference/authority-domains' },
        { text: '术语表', link: '/zh/reference/glossary' },
      ],
    },
  ],

  '/zh/reference/': [
    {
      text: '参考',
      items: [
        { text: '总览', link: '/zh/reference/' },
        { text: '术语表', link: '/zh/reference/glossary' },
        { text: 'World 字段', link: '/zh/reference/world-fields' },
        { text: 'Agent 字段', link: '/zh/reference/agent-fields' },
        { text: '六个基础协议', link: '/zh/reference/six-primitives' },
        { text: '状态机', link: '/zh/reference/state-machines' },
        { text: '权威域', link: '/zh/reference/authority-domains' },
        { text: '错误归属', link: '/zh/reference/error-ownership' },
        { text: '兼容性姿态', link: '/zh/reference/compatibility-posture' },
        { text: '禁用主张', link: '/zh/reference/forbidden-claims' },
        { text: 'Spec Map', link: '/zh/reference/spec-map' },
      ],
    },
  ],

  '/zh/glossary': [
    {
      text: '参考',
      items: [
        { text: '总览', link: '/zh/reference/' },
        { text: '术语表', link: '/zh/reference/glossary' },
      ],
    },
  ],
}
