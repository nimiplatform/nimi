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
    text: 'Overview',
    items: [
      { text: 'Overview', link: '/platform/' },
      { text: 'Vision', link: '/platform/vision' },
      { text: 'Protocol (Six Primitives)', link: '/platform/protocol' },
      { text: 'Authority Model', link: '/platform/authority-model' },
      { text: 'AI Last Mile', link: '/platform/ai-last-mile' },
      { text: 'AI Scope Identity', link: '/platform/ai-scope-identity' },
      { text: 'Execution Protocol', link: '/platform/execution-protocol' },
      { text: 'Roadmap', link: '/platform/roadmap' },
      { text: 'Governance', link: '/platform/governance' },
    ],
  },
  {
    text: 'Worlds',
    items: [
      { text: 'Worlds Overview', link: '/platform/worlds/' },
      { text: 'State vs History', link: '/platform/worlds/state-vs-history' },
      { text: 'OASIS', link: '/platform/worlds/oasis' },
      { text: 'World Lifecycle', link: '/platform/worlds/lifecycle' },
      { text: 'World Evolution Engine', link: '/platform/worlds/world-evolution-engine' },
      { text: 'WEE Execution', link: '/platform/worlds/wee-execution' },
    ],
  },
  {
    text: 'Agents',
    items: [
      { text: 'Agents Overview', link: '/platform/agents/' },
      { text: 'The Four Layers', link: '/platform/agents/the-four-layers' },
      { text: 'Chat And Life Tracks', link: '/platform/agents/chat-and-life-tracks' },
      { text: 'Conversation Anchor', link: '/platform/agents/conversation-anchor' },
      { text: 'Cross-Surface Continuity', link: '/platform/agents/cross-surface-continuity' },
      { text: 'Participation Authority', link: '/platform/agents/participation-authority' },
      { text: 'Cross-World Identity', link: '/platform/agents/cross-world-identity' },
      { text: 'External Agents', link: '/platform/agents/external-agents' },
      { text: 'Hook Intent', link: '/platform/agents/hook-intent' },
    ],
  },
  {
    text: 'Architecture',
    items: [
      { text: 'Architecture Overview', link: '/platform/architecture/' },
      { text: 'Realm And Runtime As Siblings', link: '/platform/architecture/realm-runtime-siblings' },
      { text: 'Local-First With Federation', link: '/platform/architecture/local-first-with-federation' },
      { text: 'Cross-Domain Product Stories', link: '/platform/architecture/cross-domain-product-stories' },
    ],
  },
  {
    text: 'Kit',
    items: [
      { text: 'Platform Kit', link: '/platform/kit/' },
      { text: 'Design Pattern', link: '/platform/kit/design-pattern' },
      { text: 'Nimi UI Material', link: '/platform/kit/nimi-ui-material' },
    ],
  },
]

const runtimeGroups: DefaultTheme.SidebarItem[] = [
  {
    text: 'Overview',
    items: [
      { text: 'Overview', link: '/runtime/' },
      { text: 'CLI And Daemon', link: '/runtime/cli-and-daemon' },
    ],
  },
  {
    text: 'Provider Routing',
    items: [
      { text: 'Connectors And Providers', link: '/runtime/connectors-and-providers' },
      { text: 'Local Models', link: '/runtime/local-models' },
    ],
  },
  {
    text: 'Execution',
    items: [
      { text: 'Workflows', link: '/runtime/workflows' },
      { text: 'Streaming', link: '/runtime/streaming' },
      { text: 'Streaming Protocol', link: '/runtime/streaming-protocol' },
      { text: 'Multimodal', link: '/runtime/multimodal' },
      { text: 'Voice Asset Lifecycle', link: '/runtime/voice-asset-lifecycle' },
      { text: 'MCP Integration', link: '/runtime/mcp-integration' },
    ],
  },
  {
    text: 'Agent And Memory',
    items: [
      { text: 'Agent Execution', link: '/runtime/agent-execution' },
      { text: 'Agent Presentation Stream', link: '/runtime/presentation-stream' },
      { text: 'Account And Session', link: '/runtime/account-and-session' },
      { text: 'Auth Token Validation', link: '/runtime/auth-token-validation' },
      { text: 'AI Profile Execution', link: '/runtime/ai-profile-execution' },
      { text: 'Key Source Routing', link: '/runtime/key-source-routing' },
      { text: 'Runtime Config', link: '/runtime/config-contract' },
      { text: 'App Messaging', link: '/runtime/app-messaging' },
      { text: 'Memory And Knowledge', link: '/runtime/memory-and-knowledge' },
    ],
  },
  {
    text: 'Capability And Audit',
    items: [
      { text: 'Delegated Capability', link: '/runtime/delegated-capability' },
      { text: 'Local Audit', link: '/runtime/audit-local' },
    ],
  },
]

const sdkGroups: DefaultTheme.SidebarItem[] = [
  {
    text: 'Overview',
    items: [
      { text: 'Overview', link: '/sdk/' },
      { text: 'Boundaries', link: '/sdk/boundaries' },
    ],
  },
  {
    text: 'Sub-Paths',
    items: [
      { text: 'Runtime Client', link: '/sdk/runtime-client' },
      { text: 'Realm And World Client', link: '/sdk/realm-world-client' },
      { text: 'AI Provider', link: '/sdk/ai-provider' },
      { text: 'Scope And Mods', link: '/sdk/scope-and-mods' },
      { text: 'Shared Types', link: '/sdk/types' },
    ],
  },
  {
    text: 'Client APIs',
    items: [
      { text: 'Agent Participation Client', link: '/sdk/agent-participation-client' },
      { text: 'Avatar Control Client', link: '/sdk/avatar-control-client' },
      { text: 'Delegation Client', link: '/sdk/delegation-client' },
      { text: 'Local Environment Projection', link: '/sdk/local-environment-projection' },
      { text: 'AI Config Surface', link: '/sdk/ai-config-surface' },
      { text: 'WEE Projection', link: '/sdk/wee-projection' },
      { text: 'WEE Consumer', link: '/sdk/wee-consumer' },
      { text: 'Transport And Error', link: '/sdk/transport-and-error' },
    ],
  },
]

const desktopGroups: DefaultTheme.SidebarItem[] = [
  {
    text: 'Overview',
    items: [
      { text: 'Overview', link: '/desktop/' },
      { text: 'Web Mode', link: '/desktop/web-mode' },
    ],
  },
  {
    text: 'User Surfaces',
    items: [
      { text: 'Chat', link: '/desktop/chat' },
      { text: 'Agent Avatar (Chat Surface)', link: '/desktop/agent-avatar' },
      { text: 'Voice Session', link: '/desktop/voice-session' },
      { text: 'Conversation Capability', link: '/desktop/conversation-capability' },
      { text: 'Message Actions', link: '/desktop/message-actions' },
      { text: 'AI Profile Config', link: '/desktop/ai-profile-config' },
      { text: 'Knowledge UI', link: '/desktop/knowledge-ui' },
      { text: 'Delegation Control', link: '/desktop/delegation-control' },
      { text: 'Hook Capability Allowlists', link: '/desktop/hook-capability-allowlists' },
      { text: 'Contacts And Social', link: '/desktop/contacts-and-social' },
      { text: 'Profile', link: '/desktop/profile' },
      { text: 'Economy / Wallet', link: '/desktop/economy' },
      { text: 'Explore And Worlds', link: '/desktop/explore-and-worlds' },
      { text: 'Home And Notification', link: '/desktop/home-and-notification' },
    ],
  },
  {
    text: 'Mod And External AI',
    items: [
      { text: 'Mod Hub', link: '/desktop/mod-hub' },
      { text: 'Mod Workspace', link: '/desktop/mod-workspace' },
      { text: 'Mods (Governance)', link: '/desktop/mods' },
      { text: 'External Agent Access', link: '/desktop/external-agent' },
    ],
  },
  {
    text: 'Local AI',
    items: [
      { text: 'Local AI', link: '/desktop/local-ai' },
    ],
  },
]

const realmGroups: DefaultTheme.SidebarItem[] = [
  {
    text: 'Overview',
    items: [
      { text: 'Overview', link: '/realm/' },
    ],
  },
  {
    text: 'World Semantics',
    items: [
      { text: 'Truth', link: '/realm/truth' },
      { text: 'World State', link: '/realm/world-state' },
      { text: 'World History', link: '/realm/world-history' },
      { text: 'Projection', link: '/realm/projection' },
    ],
  },
  {
    text: 'Domain Surfaces',
    items: [
      { text: 'Chat', link: '/realm/chat' },
      { text: 'Social And Economy', link: '/realm/social-and-economy' },
      { text: 'Asset And Binding', link: '/realm/asset-and-binding' },
      { text: 'Transit', link: '/realm/transit' },
    ],
  },
  {
    text: 'Creator + App',
    items: [
      { text: 'Creator Economy', link: '/realm/creator-economy' },
      { text: 'Creator Payouts', link: '/realm/creator-payouts' },
      { text: 'App Interconnect', link: '/realm/app-interconnect' },
    ],
  },
]

const avatarGroups: DefaultTheme.SidebarItem[] = [
  {
    text: 'Overview',
    items: [
      { text: 'Overview', link: '/avatar/' },
      { text: 'Nimi Avatar (App)', link: '/avatar/nimi-avatar' },
      { text: 'Host-Agnostic Architecture', link: '/avatar/host-agnostic-architecture' },
      { text: 'Instance Lifecycle', link: '/avatar/instance-lifecycle' },
    ],
  },
  {
    text: 'Embodiment',
    items: [
      { text: 'Embodiment Projection', link: '/avatar/embodiment-projection' },
      { text: 'Backend Branches', link: '/avatar/backend-branches' },
      { text: 'Live2D Integration', link: '/avatar/live2d-integration' },
      { text: 'Generated Motion Provider', link: '/avatar/generated-motion-provider' },
      { text: 'Carrier Visual Acceptance', link: '/avatar/carrier-acceptance' },
      { text: 'Visual Acceptance', link: '/avatar/visual-acceptance' },
    ],
  },
  {
    text: 'Scripting',
    items: [
      { text: 'Agent Script (NAS)', link: '/avatar/agent-script' },
      { text: 'NAS Handler Authoring', link: '/avatar/nas-handler-authoring' },
      { text: 'Avatar Events', link: '/avatar/avatar-events' },
    ],
  },
  {
    text: 'Tooling',
    items: [
      { text: 'Test Fixtures', link: '/avatar/test-fixtures' },
      { text: 'Debug Workbench', link: '/avatar/debug-workbench' },
    ],
  },
]

const cognitionGroups: DefaultTheme.SidebarItem[] = [
  {
    text: 'Overview',
    items: [
      { text: 'Overview', link: '/cognition/' },
    ],
  },
  {
    text: 'Standalone Authority',
    items: [
      { text: 'Memory + Knowledge Composition', link: '/cognition/memory-knowledge-composition' },
      { text: 'Memory Service', link: '/cognition/memory' },
      { text: 'Knowledge Service', link: '/cognition/knowledge' },
      { text: 'Prompt Serving', link: '/cognition/prompt-serving' },
      { text: 'Prompt Lanes', link: '/cognition/prompt-lanes' },
      { text: 'Completion', link: '/cognition/completion' },
      { text: 'Skill Service', link: '/cognition/skill-service' },
      { text: 'Skill Artifacts', link: '/cognition/skill-artifacts' },
      { text: 'Reference Graph', link: '/cognition/reference-graph' },
    ],
  },
  {
    text: 'Runtime Bridge',
    items: [
      { text: 'Runtime Bridge', link: '/cognition/runtime-bridge' },
      { text: 'Runtime Upgrade', link: '/cognition/runtime-upgrade' },
    ],
  },
]

const nimicodingGroups: DefaultTheme.SidebarItem[] = [
  {
    text: 'Overview',
    items: [
      { text: 'Overview', link: '/nimicoding/' },
      { text: 'Whitepaper', link: '/nimicoding/whitepaper' },
    ],
  },
  {
    text: 'The Paradigm',
    items: [
      { text: 'The Paradigm', link: '/nimicoding/the-paradigm' },
      { text: 'Four Closures', link: '/nimicoding/four-closures' },
      { text: 'False Closure Typology', link: '/nimicoding/false-closure-typology' },
      { text: 'Forbidden Shortcuts', link: '/nimicoding/forbidden-shortcuts' },
    ],
  },
  {
    text: 'Roles And Convergence',
    items: [
      { text: 'Role Separation', link: '/nimicoding/role-separation' },
      { text: 'Authority Convergence', link: '/nimicoding/authority-convergence' },
    ],
  },
  {
    text: 'Lifecycle',
    items: [
      { text: 'Topic Lifecycle', link: '/nimicoding/topic-lifecycle' },
      { text: 'Topic Workflow', link: '/nimicoding/topic-workflow' },
      { text: 'Walkthrough', link: '/nimicoding/walkthrough' },
    ],
  },
  {
    text: 'The Package',
    items: [
      { text: 'The Package', link: '/nimicoding/the-package' },
      { text: 'Host-Agnostic Boundary', link: '/nimicoding/host-agnostic' },
      { text: 'Skills', link: '/nimicoding/skills' },
      { text: 'CLI Surface', link: '/nimicoding/cli' },
      { text: 'CLI Reference', link: '/nimicoding/cli-reference' },
      { text: 'Installation', link: '/nimicoding/installation' },
    ],
  },
  {
    text: 'Comparison And Adoption',
    items: [
      { text: 'Comparison', link: '/nimicoding/comparison' },
      { text: 'Adoption Path', link: '/nimicoding/adoption-path' },
    ],
  },
  {
    text: 'Tutorials',
    items: [
      { text: 'Tutorials Overview', link: '/nimicoding/tutorials/' },
      { text: 'Project To Governed Execution', link: '/nimicoding/tutorials/project-to-governed-execution' },
      { text: 'First Topic Bootstrap', link: '/nimicoding/tutorials/first-topic' },
      { text: 'First Wave End-To-End', link: '/nimicoding/tutorials/first-wave-end-to-end' },
    ],
  },
  {
    text: 'How-to',
    items: [
      { text: 'How-to Overview', link: '/nimicoding/how-to/' },
      { text: 'Admit A Wave', link: '/nimicoding/how-to/admit-a-wave' },
      { text: 'Write Fail-Close Invariants', link: '/nimicoding/how-to/write-fail-close-invariants' },
      { text: 'Handle Pending Acceptance', link: '/nimicoding/how-to/handle-pending-acceptance' },
      { text: 'Reconcile Divergent Audits', link: '/nimicoding/how-to/reconcile-divergent-audits' },
      { text: 'Reopen After Overflow', link: '/nimicoding/how-to/reopen-after-overflow' },
      { text: 'Admit An External Host', link: '/nimicoding/how-to/admit-an-external-host' },
    ],
  },
  {
    text: 'Reference',
    items: [
      { text: 'Reference Overview', link: '/nimicoding/reference/' },
      { text: 'CLI Commands', link: '/nimicoding/reference/cli-commands' },
      { text: 'Schemas', link: '/nimicoding/reference/schemas' },
      { text: 'Forbidden Shortcuts Catalog', link: '/nimicoding/reference/forbidden-shortcuts-catalog' },
    ],
  },
  {
    text: 'Appendix',
    items: [
      { text: 'oh-my-codex Adapter', link: '/nimicoding/appendix/oh-my-codex' },
    ],
  },
]

const DOMAINS: DomainEntry[] = [
  { key: 'platform', text: 'Platform', groups: platformGroups },
  { key: 'runtime', text: 'Runtime', groups: runtimeGroups },
  { key: 'sdk', text: 'SDK', groups: sdkGroups },
  { key: 'desktop', text: 'Desktop', groups: desktopGroups },
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

export const sidebarEn: DefaultTheme.Sidebar = {
  '/start/': [
    {
      text: 'Start',
      items: [
        { text: 'Start Here', link: '/start/' },
        { text: 'Personas', link: '/start/personas' },
        { text: 'Installation And Availability', link: '/start/install' },
      ],
    },
    {
      text: 'Continue',
      items: [
        { text: 'Platform', link: '/platform/' },
        { text: 'Runtime', link: '/runtime/' },
        { text: 'SDK', link: '/sdk/' },
        { text: 'Desktop', link: '/desktop/' },
        { text: 'Realm', link: '/realm/' },
        { text: 'Avatar', link: '/avatar/' },
        { text: 'Cognition', link: '/cognition/' },
        { text: 'Nimi Coding', link: '/nimicoding/' },
      ],
    },
  ],

  '/platform/': buildDocsSidebar('platform'),
  '/runtime/': buildDocsSidebar('runtime'),
  '/sdk/': buildDocsSidebar('sdk'),
  '/desktop/': buildDocsSidebar('desktop'),
  '/realm/': buildDocsSidebar('realm'),
  '/avatar/': buildDocsSidebar('avatar'),
  '/cognition/': buildDocsSidebar('cognition'),
  '/nimicoding/': buildDocsSidebar('nimicoding'),

  '/reference/': [
    {
      text: 'Reference',
      items: [
        { text: 'Overview', link: '/reference/' },
        { text: 'Glossary', link: '/reference/glossary' },
        { text: 'World Fields', link: '/reference/world-fields' },
        { text: 'Agent Fields', link: '/reference/agent-fields' },
        { text: 'Six Primitives', link: '/reference/six-primitives' },
        { text: 'State Machines', link: '/reference/state-machines' },
        { text: 'Authority Domains', link: '/reference/authority-domains' },
        { text: 'Error Ownership', link: '/reference/error-ownership' },
        { text: 'Compatibility Posture', link: '/reference/compatibility-posture' },
        { text: 'Forbidden Claims', link: '/reference/forbidden-claims' },
        { text: 'Spec Map', link: '/reference/spec-map' },
      ],
    },
  ],
}
