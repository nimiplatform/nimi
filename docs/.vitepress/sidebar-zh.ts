import type { DefaultTheme } from 'vitepress'

type DomainKey =
  | 'platform'
  | 'runtime'
  | 'sdk'
  | 'desktop'
  | 'realm'
  | 'avatar'
  | 'cognition'
  | 'nimicoding'

interface DomainEntry {
  key: DomainKey
  text: string
  groups: DefaultTheme.SidebarItem[]
}

const platformGroups: DefaultTheme.SidebarItem[] = [
  {
    text: '总览',
    items: [
      { text: '总览', link: '/zh/platform/' },
      { text: '愿景', link: '/zh/platform/vision' },
      { text: '协议（六个基础协议）', link: '/zh/platform/protocol' },
      { text: '权威模型', link: '/zh/platform/authority-model' },
      { text: 'AI 最后一公里', link: '/zh/platform/ai-last-mile' },
      { text: 'AI 范围身份', link: '/zh/platform/ai-scope-identity' },
      { text: '执行协议', link: '/zh/platform/execution-protocol' },
      { text: '路线图', link: '/zh/platform/roadmap' },
      { text: '治理', link: '/zh/platform/governance' },
    ],
  },
  {
    text: '世界',
    items: [
      { text: '世界总览', link: '/zh/platform/worlds/' },
      { text: '真相、状态与历史', link: '/zh/platform/worlds/state-vs-history' },
      { text: 'OASIS', link: '/zh/platform/worlds/oasis' },
      { text: '世界生命周期', link: '/zh/platform/worlds/lifecycle' },
      { text: '世界演化引擎', link: '/zh/platform/worlds/world-evolution-engine' },
      { text: 'WEE 执行', link: '/zh/platform/worlds/wee-execution' },
    ],
  },
  {
    text: 'Agent',
    items: [
      { text: 'Agent 总览', link: '/zh/platform/agents/' },
      { text: '四层结构', link: '/zh/platform/agents/the-four-layers' },
      { text: 'Chat 与 Life 双轨', link: '/zh/platform/agents/chat-and-life-tracks' },
      { text: '对话锚点', link: '/zh/platform/agents/conversation-anchor' },
      { text: '跨表面连续性', link: '/zh/platform/agents/cross-surface-continuity' },
      { text: '参与权限', link: '/zh/platform/agents/participation-authority' },
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
    text: 'Kit',
    items: [
      { text: '平台 Kit', link: '/zh/platform/kit/' },
      { text: '在 App 中使用 Kit', link: '/zh/platform/kit/use-kit-in-app' },
      { text: '设计模式', link: '/zh/platform/kit/design-pattern' },
      { text: 'Nimi UI Material', link: '/zh/platform/kit/nimi-ui-material' },
    ],
  },
]

const runtimeGroups: DefaultTheme.SidebarItem[] = [
  {
    text: '总览',
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
      { text: '流式协议', link: '/zh/runtime/streaming-protocol' },
      { text: '多模态', link: '/zh/runtime/multimodal' },
      { text: '语音资产生命周期', link: '/zh/runtime/voice-asset-lifecycle' },
      { text: 'MCP 集成', link: '/zh/runtime/mcp-integration' },
    ],
  },
  {
    text: 'Agent 与记忆',
    items: [
      { text: 'Agent 执行', link: '/zh/runtime/agent-execution' },
      { text: 'Agent 展示流', link: '/zh/runtime/presentation-stream' },
      { text: '账户与会话', link: '/zh/runtime/account-and-session' },
      { text: '认证令牌验证', link: '/zh/runtime/auth-token-validation' },
      { text: 'AI Profile 执行', link: '/zh/runtime/ai-profile-execution' },
      { text: '密钥源路由', link: '/zh/runtime/key-source-routing' },
      { text: 'Runtime 配置', link: '/zh/runtime/config-contract' },
      { text: '应用消息', link: '/zh/runtime/app-messaging' },
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
]

const sdkGroups: DefaultTheme.SidebarItem[] = [
  {
    text: '总览',
    items: [
      { text: '总览', link: '/zh/sdk/' },
      { text: '第一次 AI 调用', link: '/zh/sdk/first-ai-call' },
      { text: '边界', link: '/zh/sdk/boundaries' },
    ],
  },
  {
    text: '子路径',
    items: [
      { text: 'Runtime Client', link: '/zh/sdk/runtime-client' },
      { text: 'Realm 与组合', link: '/zh/sdk/realm-world-client' },
      { text: '适配器', link: '/zh/sdk/adapters' },
      { text: '共享类型', link: '/zh/sdk/types' },
    ],
  },
  {
    text: 'Client APIs',
    items: [
      { text: 'Agent 参与客户端', link: '/zh/sdk/agent-participation-client' },
      { text: 'Avatar 控制客户端', link: '/zh/sdk/avatar-control-client' },
      { text: '委派客户端', link: '/zh/sdk/delegation-client' },
      { text: '本地环境投影', link: '/zh/sdk/local-environment-projection' },
      { text: 'AI 配置界面', link: '/zh/sdk/ai-config-surface' },
      { text: 'WEE 投影', link: '/zh/sdk/wee-projection' },
      { text: 'WEE 消费者', link: '/zh/sdk/wee-consumer' },
      { text: '传输与错误', link: '/zh/sdk/transport-and-error' },
    ],
  },
]

const desktopGroups: DefaultTheme.SidebarItem[] = [
  {
    text: '总览',
    items: [
      { text: '总览', link: '/zh/desktop/' },
      { text: '网页端模式', link: '/zh/desktop/web-mode' },
    ],
  },
  {
    text: '用户界面',
    items: [
      { text: '聊天', link: '/zh/desktop/chat' },
      { text: 'Agent Avatar（聊天界面）', link: '/zh/desktop/agent-avatar' },
      { text: '语音会话', link: '/zh/desktop/voice-session' },
      { text: '对话能力', link: '/zh/desktop/conversation-capability' },
      { text: '消息操作', link: '/zh/desktop/message-actions' },
      { text: 'AI Profile 配置', link: '/zh/desktop/ai-profile-config' },
      { text: '知识 UI', link: '/zh/desktop/knowledge-ui' },
      { text: '委派控制', link: '/zh/desktop/delegation-control' },
      { text: '关系与社交', link: '/zh/desktop/contacts-and-social' },
      { text: '个人主页', link: '/zh/desktop/profile' },
      { text: '经济 / 钱包', link: '/zh/desktop/economy' },
      { text: '探索与世界', link: '/zh/desktop/explore-and-worlds' },
      { text: '主页与通知', link: '/zh/desktop/home-and-notification' },
    ],
  },
  {
    text: '外部 AI',
    items: [
      { text: '外部 Agent 接入', link: '/zh/desktop/external-agent' },
    ],
  },
  {
    text: '本地 AI',
    items: [
      { text: '本地 AI', link: '/zh/desktop/local-ai' },
    ],
  },
]

const realmGroups: DefaultTheme.SidebarItem[] = [
  {
    text: '总览',
    items: [
      { text: '总览', link: '/zh/realm/' },
    ],
  },
  {
    text: '世界语义',
    items: [
      { text: '外部真相边界', link: '/zh/realm/truth' },
      { text: '世界状态', link: '/zh/realm/world-state' },
      { text: '世界历史', link: '/zh/realm/world-history' },
      { text: '消费者投影', link: '/zh/realm/projection' },
    ],
  },
  {
    text: 'Realm 界面',
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
      { text: '创作者收益', link: '/zh/realm/creator-payouts' },
      { text: 'App 互联', link: '/zh/realm/app-interconnect' },
    ],
  },
]

const avatarGroups: DefaultTheme.SidebarItem[] = [
  {
    text: '总览',
    items: [
      { text: '总览', link: '/zh/avatar/' },
      { text: 'Nimi Avatar (App)', link: '/zh/avatar/nimi-avatar' },
      { text: '宿主无关架构', link: '/zh/avatar/host-agnostic-architecture' },
      { text: '实例生命周期', link: '/zh/avatar/instance-lifecycle' },
    ],
  },
  {
    text: '具身化',
    items: [
      { text: '具身化呈现', link: '/zh/avatar/embodiment-projection' },
      { text: '后端分支', link: '/zh/avatar/backend-branches' },
      { text: 'Live2D 集成', link: '/zh/avatar/live2d-integration' },
      { text: 'VRM 动作编写', link: '/zh/avatar/vrm-motion-authoring' },
      { text: '生成式动作提供器', link: '/zh/avatar/generated-motion-provider' },
      { text: '载体视觉可接受性', link: '/zh/avatar/carrier-acceptance' },
      { text: '视觉接受度', link: '/zh/avatar/visual-acceptance' },
    ],
  },
  {
    text: '脚本',
    items: [
      { text: 'Agent Script (NAS)', link: '/zh/avatar/agent-script' },
      { text: 'NAS 处理程序编写', link: '/zh/avatar/nas-handler-authoring' },
      { text: 'Avatar 事件', link: '/zh/avatar/avatar-events' },
    ],
  },
  {
    text: '工具',
    items: [
      { text: '测试夹具', link: '/zh/avatar/test-fixtures' },
      { text: '调试工作台', link: '/zh/avatar/debug-workbench' },
    ],
  },
]

const cognitionGroups: DefaultTheme.SidebarItem[] = [
  {
    text: '总览',
    items: [
      { text: '总览', link: '/zh/cognition/' },
    ],
  },
  {
    text: '独立权威',
    items: [
      { text: '记忆与知识组合', link: '/zh/cognition/memory-knowledge-composition' },
      { text: '记忆服务', link: '/zh/cognition/memory' },
      { text: '知识服务', link: '/zh/cognition/knowledge' },
      { text: 'Prompt 服务', link: '/zh/cognition/prompt-serving' },
      { text: 'Prompt 通道', link: '/zh/cognition/prompt-lanes' },
      { text: 'Completion', link: '/zh/cognition/completion' },
      { text: '技能服务', link: '/zh/cognition/skill-service' },
      { text: '技能工件', link: '/zh/cognition/skill-artifacts' },
      { text: '引用图', link: '/zh/cognition/reference-graph' },
    ],
  },
  {
    text: 'Runtime 桥',
    items: [
      { text: 'Runtime 桥', link: '/zh/cognition/runtime-bridge' },
      { text: 'Runtime 升级', link: '/zh/cognition/runtime-upgrade' },
    ],
  },
]

const nimicodingGroups: DefaultTheme.SidebarItem[] = [
  {
    text: '总览',
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
    ],
  },
  {
    text: '角色',
    items: [
      { text: '角色分离', link: '/zh/nimicoding/role-separation' },
    ],
  },
  {
    text: '方法论与证据',
    items: [
      { text: '走查', link: '/zh/nimicoding/walkthrough' },
    ],
  },
  {
    text: '包',
    items: [
      { text: '包', link: '/zh/nimicoding/the-package' },
      { text: '宿主无关边界', link: '/zh/nimicoding/host-agnostic' },
      { text: 'CLI 界面', link: '/zh/nimicoding/cli' },
      { text: 'CLI 参考', link: '/zh/nimicoding/cli-reference' },
      { text: '安装', link: '/zh/nimicoding/installation' },
    ],
  },
  {
    text: '教程',
    items: [
      { text: '教程总览', link: '/zh/nimicoding/tutorials/' },
      { text: '用 Codex 开展受治理开发', link: '/zh/nimicoding/tutorials/project-to-governed-execution' },
      { text: '验证治理设置', link: '/zh/nimicoding/tutorials/project-bootstrap' },
    ],
  },
  {
    text: 'How-to',
    items: [
      { text: 'How-to 总览', link: '/zh/nimicoding/how-to/' },
      { text: '编写故障关闭不变量', link: '/zh/nimicoding/how-to/write-fail-close-invariants' },
      { text: '调和分歧审计', link: '/zh/nimicoding/how-to/reconcile-divergent-audits' },
      { text: '准入外部宿主', link: '/zh/nimicoding/how-to/admit-an-external-host' },
    ],
  },
  {
    text: '参考',
    items: [
      { text: '参考总览', link: '/zh/nimicoding/reference/' },
      { text: 'CLI 命令', link: '/zh/nimicoding/reference/cli-commands' },
      { text: 'Schema', link: '/zh/nimicoding/reference/schemas' },
    ],
  },
]

const DOMAINS: DomainEntry[] = [
  { key: 'platform', text: '平台', groups: platformGroups },
  { key: 'runtime', text: 'Runtime', groups: runtimeGroups },
  { key: 'sdk', text: 'SDK', groups: sdkGroups },
  { key: 'desktop', text: '桌面端', groups: desktopGroups },
  { key: 'realm', text: 'Realm', groups: realmGroups },
  { key: 'avatar', text: 'Avatar', groups: avatarGroups },
  { key: 'cognition', text: 'Cognition', groups: cognitionGroups },
  { key: 'nimicoding', text: 'Nimi Coding', groups: nimicodingGroups },
]

function buildDocsSidebar(currentKey: DomainKey): DefaultTheme.SidebarItem[] {
  return DOMAINS.map((d) => ({
    text: d.text,
    collapsed: d.key !== currentKey,
    items: d.groups,
  }))
}

export const sidebarZh: DefaultTheme.Sidebar = {
  '/zh/start/': [
    {
      text: '开始',
      items: [
        { text: '从这里开始', link: '/zh/start/' },
        { text: '用户画像', link: '/zh/start/personas' },
        { text: '安装与可用性', link: '/zh/start/install' },
        { text: '创建 Nimi App', link: '/zh/start/create-an-app' },
        { text: '把 Tester 当作参考 App', link: '/zh/start/use-tester-as-reference' },
        { text: '故障排查', link: '/zh/start/troubleshooting' },
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
        { text: 'Avatar', link: '/zh/avatar/' },
        { text: 'Cognition', link: '/zh/cognition/' },
        { text: 'Nimi Coding', link: '/zh/nimicoding/' },
      ],
    },
  ],

  '/zh/platform/': buildDocsSidebar('platform'),
  '/zh/runtime/': buildDocsSidebar('runtime'),
  '/zh/sdk/': buildDocsSidebar('sdk'),
  '/zh/desktop/': buildDocsSidebar('desktop'),
  '/zh/realm/': buildDocsSidebar('realm'),
  '/zh/avatar/': buildDocsSidebar('avatar'),
  '/zh/cognition/': buildDocsSidebar('cognition'),
  '/zh/nimicoding/': buildDocsSidebar('nimicoding'),

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
}
