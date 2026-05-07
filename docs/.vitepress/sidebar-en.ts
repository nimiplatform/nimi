import type { DefaultTheme } from 'vitepress'

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
        { text: 'Nimi Coding', link: '/nimicoding/' },
      ],
    },
  ],

  '/platform/': [
    {
      text: 'Platform',
      items: [
        { text: 'Overview', link: '/platform/' },
        { text: 'Vision', link: '/platform/vision' },
        { text: 'Protocol (Six Primitives)', link: '/platform/protocol' },
        { text: 'Authority Model', link: '/platform/authority-model' },
        { text: 'AI Last Mile', link: '/platform/ai-last-mile' },
        { text: 'Governance', link: '/platform/governance' },
      ],
    },
    {
      text: 'Worlds',
      items: [
        { text: 'Worlds Overview', link: '/platform/worlds/' },
        { text: 'Truth, State, And History', link: '/platform/worlds/truth-state-history' },
        { text: 'OASIS', link: '/platform/worlds/oasis' },
        { text: 'World Lifecycle', link: '/platform/worlds/lifecycle' },
        { text: 'World Evolution Engine', link: '/platform/worlds/world-evolution-engine' },
      ],
    },
    {
      text: 'Agents',
      items: [
        { text: 'Agents Overview', link: '/platform/agents/' },
        { text: 'The Four Layers', link: '/platform/agents/the-four-layers' },
        { text: 'Chat And Life Tracks', link: '/platform/agents/chat-and-life-tracks' },
        { text: 'Conversation Anchor', link: '/platform/agents/conversation-anchor' },
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
      text: 'Adjacent Authority Domains',
      items: [
        { text: 'Realm', link: '/realm/' },
        { text: 'Avatar', link: '/avatar/' },
        { text: 'Cognition', link: '/cognition/' },
      ],
    },
  ],

  '/runtime/': [
    {
      text: 'Runtime',
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
        { text: 'Multimodal', link: '/runtime/multimodal' },
      ],
    },
    {
      text: 'Agent And Memory',
      items: [
        { text: 'Agent Execution', link: '/runtime/agent-execution' },
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
    {
      text: 'Related',
      items: [
        { text: 'SDK Boundary', link: '/sdk/boundaries' },
        { text: 'Cognition Bridge', link: '/cognition/' },
        { text: 'Error Ownership', link: '/reference/error-ownership' },
      ],
    },
  ],

  '/sdk/': [
    {
      text: 'SDK',
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
      text: 'Related',
      items: [
        { text: 'Runtime', link: '/runtime/' },
        { text: 'Realm', link: '/realm/' },
        { text: 'Error Ownership', link: '/reference/error-ownership' },
      ],
    },
  ],

  '/desktop/': [
    {
      text: 'Desktop',
      items: [
        { text: 'Overview', link: '/desktop/' },
        { text: 'Web Mode', link: '/desktop/web-mode' },
      ],
    },
    {
      text: 'User Surfaces',
      items: [
        { text: 'Chat', link: '/desktop/chat' },
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
    {
      text: 'Related',
      items: [
        { text: 'Runtime', link: '/runtime/' },
        { text: 'SDK', link: '/sdk/' },
        { text: 'Avatar', link: '/avatar/' },
      ],
    },
  ],

  '/realm/': [
    {
      text: 'Realm',
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
        { text: 'App Interconnect', link: '/realm/app-interconnect' },
      ],
    },
    {
      text: 'Related',
      items: [
        { text: 'Platform Boundary', link: '/platform/' },
        { text: 'SDK Realm/World Client', link: '/sdk/realm-world-client' },
        { text: 'World Fields', link: '/reference/world-fields' },
        { text: 'Spec Map', link: '/reference/spec-map' },
      ],
    },
  ],

  '/avatar/': [
    {
      text: 'Avatar',
      items: [
        { text: 'Overview', link: '/avatar/' },
        { text: 'Nimi Avatar (App)', link: '/avatar/nimi-avatar' },
      ],
    },
    {
      text: 'Embodiment',
      items: [
        { text: 'Embodiment Projection', link: '/avatar/embodiment-projection' },
        { text: 'Carrier Visual Acceptance', link: '/avatar/carrier-acceptance' },
        { text: 'Backend Branches', link: '/avatar/backend-branches' },
      ],
    },
    {
      text: 'Scripting',
      items: [
        { text: 'Agent Script (NAS)', link: '/avatar/agent-script' },
        { text: 'Avatar Events', link: '/avatar/avatar-events' },
      ],
    },
    {
      text: 'Related',
      items: [
        { text: 'Platform', link: '/platform/' },
        { text: 'Desktop', link: '/desktop/' },
        { text: 'Cognition', link: '/cognition/' },
        { text: 'Agent Fields', link: '/reference/agent-fields' },
      ],
    },
  ],

  '/cognition/': [
    {
      text: 'Cognition',
      items: [
        { text: 'Overview', link: '/cognition/' },
      ],
    },
    {
      text: 'Standalone Authority',
      items: [
        { text: 'Memory Service', link: '/cognition/memory' },
        { text: 'Knowledge Service', link: '/cognition/knowledge' },
        { text: 'Prompt Serving', link: '/cognition/prompt-serving' },
        { text: 'Completion', link: '/cognition/completion' },
        { text: 'Skill Service', link: '/cognition/skill-service' },
      ],
    },
    {
      text: 'Runtime Bridge',
      items: [
        { text: 'Runtime Bridge', link: '/cognition/runtime-bridge' },
        { text: 'Runtime Upgrade', link: '/cognition/runtime-upgrade' },
      ],
    },
    {
      text: 'Related',
      items: [
        { text: 'Runtime', link: '/runtime/' },
        { text: 'Avatar', link: '/avatar/' },
        { text: 'Agent Fields', link: '/reference/agent-fields' },
        { text: 'Spec Map', link: '/reference/spec-map' },
      ],
    },
  ],

  '/nimicoding/': [
    {
      text: 'Nimi Coding',
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
    {
      text: 'Cross-Reference',
      items: [
        { text: 'Forbidden Claims (docs)', link: '/reference/forbidden-claims' },
        { text: 'State Machines', link: '/reference/state-machines' },
        { text: 'Authority Domains', link: '/reference/authority-domains' },
        { text: 'Glossary', link: '/reference/glossary' },
      ],
    },
  ],

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

  '/glossary': [
    {
      text: 'Reference',
      items: [
        { text: 'Overview', link: '/reference/' },
        { text: 'Glossary', link: '/reference/glossary' },
      ],
    },
  ],
}
