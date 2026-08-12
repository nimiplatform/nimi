import type { LandingContent } from './landing-content.js';

const EN_SPEC_NOTE = `Authority: .nimi/spec/**
Docs: /docs/reference/spec-map
Boundary: public projection, not independent truth`;

export const landingContentEn: LandingContent = {
  skipToContent: 'Skip to main content',
  nav: {
    enterNimi: 'Enter Nimi',
    install: 'Start',
    sdk: 'SDK',
    catalog: 'Runtime',
    architecture: 'Platform',
    desktop: 'Desktop',
    apps: 'Apps',
    security: 'Governance',
    openSource: 'Source',
    faq: 'FAQ',
  },
  hero: {
    eyebrow: 'Open-source, local-first AI runtime',
    title: 'Build agents that live in worlds,',
    titleAccent: 'not chats.',
    subtitle:
      'Open-source runtime, typed SDK, multi-provider AI, and embodied agents — built on contracts you can read.',
    helperPrefix: 'Or',
    helperDocsCta: 'Read Docs',
    helperGithubCta: 'View Source',
    copyTooltipLabel: 'Copy link',
    copiedCommandLabel: 'Copied',
    previewAlt: 'Nimi runtime quickstart preview',
    getStartedTitle: 'Quickstart',
    getStartedSubtitle: 'Pick your integration entry',
    tabs: [
      {
        id: 'start',
        label: 'Source',
        command: 'pnpm install && pnpm build:runtime',
        ctaText: 'Read Setup Docs',
      },
      {
        id: 'runtime',
        label: 'CLI',
        command: './dist/nimi doctor',
        ctaText: 'Read Runtime Docs',
      },
      {
        id: 'platform',
        label: 'Platform',
        command: 'docs.nimi.ai/platform',
        ctaText: 'Read Platform Docs',
      },
      { id: 'sdk', label: 'SDK', command: 'docs.nimi.ai/sdk', ctaText: 'Read SDK Docs' },
    ],
  },
  architecture: {
    title: 'One platform, many worlds.',
    subtitle: 'Architecture',
    description:
      'Nimi provides a typed SDK for AI experiences across persistent worlds, autonomous agents, shared memory, identity, social systems, and economy. Runtime executes capabilities locally or in the cloud.',
    devTitle: 'For builders',
    devText:
      'Integrate through the typed SDK. Compose character-backed agents, capabilities, conversations, and memory while Runtime owns Local or Cloud implementation selection.',
    userTitle: 'For product readers',
    userText:
      'Nimi is an AI open world platform — agents persist across sessions, share state across worlds, and act through runtime capabilities with clear limits. Not a chat wrapper, not a single-purpose app.',
    conclusion: 'Concept-led, contracts-first, runtime-anywhere.',
    slogan: 'Your code, your contracts, your worlds.',
    diagram: {
      appLabel: 'YOUR AI APP',
      realm: 'REALM',
      runtime: 'RUNTIME',
      cloudContextPlane: 'Cloud Context Plane',
      localExecutionPlane: 'Local Execution Plane',
      cloudContext: 'Cloud Context',
      localCompute: 'Local Compute',
      realmDomains: [
        { id: 'worlds', label: 'Worlds', icon: '\u{1F310}' },
        { id: 'agents', label: 'Agents', icon: '\u{1F916}' },
        { id: 'social', label: 'Social', icon: '\u{1F465}' },
        { id: 'economy', label: 'Economy', icon: '\u{1F4B0}' },
        { id: 'memory', label: 'Memory', icon: '\u{1F9E0}' },
        { id: 'identity', label: 'Identity', icon: '\u{1F464}' },
      ],
      runtimeCapabilities: [
        { id: 'ai-models', label: 'AI Capabilities', icon: '\u{1F9E0}' },
        { id: 'conversations', label: 'Conversations', icon: '\u{26A1}' },
        { id: 'knowledge', label: 'Knowledge', icon: '\u{1F4DA}' },
      ],
      crossCutting: [
        { id: 'unified-account', label: 'Unified Account', icon: '\u{1F464}' },
        { id: 'shared-data', label: 'Shared Data', icon: '\u{1F4BE}' },
        { id: 'shared-auth', label: 'Shared Authorization', icon: '\u{1F512}' },
        { id: 'persistent-presence', label: 'Persistent Cross-World Presence', icon: '\u{1F310}' },
        { id: 'multi-world-exploration', label: 'Multi-World Exploration', icon: '\u{1F9ED}' },
        { id: 'seamless-ai', label: 'Seamless AI Experience', icon: '\u{2728}' },
      ],
      transportLabels: { rest: 'REST + WebSocket', grpc: 'gRPC' },
      mobileFallback: {
        sdkLabel: '@nimi/sdk',
        sdkDescription: 'Single surface connecting to local and cloud intelligence.',
      },
    },
  },
  modelCatalog: {
    kicker: 'Runtime implementation catalog',
    title: 'One capability API. Runtime selects the implementation.',
    subtitle:
      'Explore Runtime-managed Cloud implementations and Local asset compatibility. App requests stay capability-shaped.',
    overview: {
      searchPlaceholder: 'Search implementation families and capabilities',
      cloudProvidersLabel: 'Cloud Implementations',
      localModelsLabel: 'Local Assets',
      modalitiesLabel: 'Capabilities',
      modalitiesDescription: 'Text · Embeddings · Image · Video · Audio · Music · Voice · World',
      shortcutLabel: '⌘K',
      clearSearchLabel: 'Clear',
      matchingProvidersLabel: 'matching catalog entries',
      liveCatalogLabel: 'Runtime catalog',
      supportedByLabel: 'Admitted implementation families',
    },
    capabilityLabels: {
      'text.generate': 'Text generation',
      'text.embed': 'Embeddings',
      'image.generate': 'Image generation',
      'video.generate': 'Video generation',
      'audio.synthesize': 'Speech synthesis',
      'audio.transcribe': 'Speech transcription',
      'music.generate': 'Music generation',
      'voice.create': 'Voice creation',
      'world.generate': 'World generation',
    },
    providerDetailSuffix: 'capabilities',
    noResultsTitle: 'No catalog entries match.',
    noResultsDescription:
      'Try a capability or implementation-family keyword.',
    providerDisplayNames: {
      anthropic: 'Anthropic',
      aws_polly: 'AWS Polly',
      azure: 'Azure',
      azure_speech: 'Azure Speech',
      bedrock: 'AWS Bedrock',
      cohere: 'Cohere',
      dashscope: 'DashScope',
      deepseek: 'DeepSeek',
      elevenlabs: 'ElevenLabs',
      fireworks: 'Fireworks',
      fish_audio: 'Fish Audio',
      flux: 'FLUX',
      gemini: 'Gemini',
      glm: 'GLM',
      kimi: 'Kimi',
      luma: 'Luma',
      mistral: 'Mistral',
      mochi: 'Mochi',
      moonshot: 'Moonshot',
      openai: 'OpenAI',
      openai_compatible: 'OpenAI Compatible',
      perplexity: 'Perplexity',
      pika: 'Pika',
      qwen: 'Qwen',
      replicate: 'Replicate',
      runway: 'Runway',
      sora: 'Sora',
      stability: 'Stability',
      suno: 'Suno',
      together: 'Together',
      udio: 'Udio',
      veo: 'Veo',
      viggle: 'Viggle',
      volcengine: 'Volcengine',
      x_ai: 'xAI',
      xai: 'xAI',
      yi: 'Yi',
    },
    marqueeProviderOrder: ['openai', 'anthropic', 'gemini', 'deepseek', 'dashscope', 'volcengine'],
  },
  sdk: {
    eyebrow: 'One typed SDK',
    title: 'One SDK.',
    titleAccent: 'Multiple ways to run AI.',
    subtitle:
      'Compose character-backed agents, capabilities, conversations, and shared environments through one typed integration surface. Runtime owns Local or Cloud execution.',
    callout: 'Explore the SDK reference',
    primaryCta: 'Read SDK Docs',
    secondaryCta: 'View Source',
    codeWindowTitle: 'Nimi SDK / agent runtime',
    codeWindowCaption: 'One typed call surface for agent context, Runtime tasks, and Local or Cloud capability intent.',
    matrixEyebrow: 'SDK capability matrix',
    matrixTitle: 'The detailed SDK surface moves below the hero.',
    matrixSubtitle:
      'The hero stays focused; the original capability points remain available as a scannable matrix with direct reference links.',
    runtimeBadges: ['Type-safe SDK', 'Runtime-backed', 'Local-first', 'Agent Context'],
    heroHighlights: [
      {
        title: 'Realm and Runtime clients',
        description:
          'Use typed owner APIs for Realm product data and Runtime-owned LocalAgent behavior.',
      },
      {
        title: 'Task & state sync',
        description:
          'Coordinate work handoffs, world events, and status updates through typed streams.',
      },
      {
        title: 'Local / cloud runtime',
        description:
          'Use the same capability contract while Runtime interprets Local or Cloud owner intent.',
      },
    ],
    tabs: [
      {
        id: 'delegation',
        label: 'Delegation',
        description:
          'Hand off tasks between agents and humans with typed context handoff and audit trail.',
        docsPath: 'sdk/delegation-client',
        previewMediaId: 'runtime',
      },
      {
        id: 'local-environment',
        label: 'Local Environment',
        description:
          'Project shared environments into local sessions — files, tools, and runtime state.',
        docsPath: 'sdk/local-environment-projection',
        previewMediaId: 'runtime',
      },
      {
        id: 'ai-config',
        label: 'AI Config',
        description:
          'Owner-scoped Local or Cloud intent for each admitted capability; Runtime selects the implementation.',
        docsPath: 'sdk/ai-config-surface',
        previewMediaId: 'sdk',
      },
      {
        id: 'wee-projection',
        label: 'World Events',
        description: 'Stream live world execution events as typed data for product consumers.',
        docsPath: 'sdk/wee-projection',
        previewMediaId: 'streamJob',
      },
      {
        id: 'wee-consumer',
        label: 'WEE Consumer',
        description:
          'Subscribe to world execution events with backpressure-safe consumption.',
        docsPath: 'sdk/wee-consumer',
        previewMediaId: 'streamJob',
      },
      {
        id: 'transport-error',
        label: 'Transport & Error',
        description:
          'Typed transport contracts plus structured error semantics across the whole SDK.',
        docsPath: 'sdk/transport-and-error',
        previewMediaId: 'runtime',
      },
    ],
    capabilityMatrix: [
      {
        title: 'Delegation',
        description:
          'Hand off tasks between agents and humans with typed context handoff and audit trail.',
        docsPath: 'sdk/delegation-client',
      },
      {
        title: 'Local Environment',
        description:
          'Project shared environments into local sessions - files, tools, and runtime state.',
        docsPath: 'sdk/local-environment-projection',
      },
      {
        title: 'AI Config',
        description:
          'Owner-scoped Local or Cloud intent for each admitted capability; Runtime selects the implementation.',
        docsPath: 'sdk/ai-config-surface',
      },
      {
        title: 'World Events',
        description: 'Stream live world execution events as typed data for product consumers.',
        docsPath: 'sdk/wee-projection',
      },
      {
        title: 'WEE Consumer',
        description:
          'Subscribe to world execution events with backpressure-safe consumption.',
        docsPath: 'sdk/wee-consumer',
      },
      {
        title: 'Transport & Error',
        description:
          'Typed transport contracts plus structured error semantics across the whole SDK.',
        docsPath: 'sdk/transport-and-error',
      },
    ],
    previewMedia: {
      sdk: { alt: 'Nimi SDK quickstart preview' },
      multimodal: { alt: 'Nimi multimodal client preview' },
      streamJob: { alt: 'Nimi stream job preview' },
      runtime: { alt: 'Nimi typed Runtime client preview' },
    },
  },
  desktop: {
    title: 'Native desktop. Real web boundary.',
    subtitle:
      'Desktop is the full app — embedded runtime, local AI, your machine. Web mode runs the same shell with explicit web-only adapters. Both ship as real surfaces.',
    chromeLabels: {
      appName: 'Nimi',
      runtime: 'Runtime',
      workspace: 'Workspace',
      capabilities: 'Capability intent',
      localIntent: 'Local intent',
      cloudIntent: 'Cloud intent',
    },
    features: [
      {
        icon: 'dashboard',
        title: 'Runtime Overview',
        description: 'Review Runtime activity, resource usage, and active sessions at a glance.',
      },
      {
        icon: 'chat',
        title: 'Built-in Chat',
        description: 'Use the same conversation surface with Local or Cloud capability intent.',
      },
      {
        icon: 'models',
        title: 'Local AI Assets',
        description: 'Install and update Runtime-managed AI assets from one place.'
      },
      {
        icon: 'apps',
        title: 'App Launcher',
        description: 'Open available Nimi Apps and your connected local apps from one workspace.',
      },
    ],
    downloadCta: 'Read Desktop Docs',
    availability: {
      eyebrow: 'Available now',
      items: [
        'Native shell on macOS, Linux, and Windows',
        'Browser-only sessions via web mode',
        'Local AI + runtime built-in',
      ],
    },
  },
  apps: {
    eyebrow: 'Nimi Apps',
    title: 'Bring new abilities into Nimi.',
    subtitle:
      'Nimi Apps are small apps you can open inside Nimi. They can add tools, scenes, or local AI experiences. Desktop shows what is available for your account and local workspace; developers build with the SDK and ship through clear product rules.',
    cta: 'Read Desktop Docs',
    cards: [
      {
        label: 'Use',
        title: 'Open apps in one place',
        description:
          'Use the Apps area in Desktop to open the tools, scenes, or local AI experiences that are available in your current product context.',
      },
      {
        label: 'Build',
        title: 'Build with the SDK',
        description:
          'Developers can turn product ideas into Nimi Apps and invoke Runtime capabilities through the SDK without choosing an implementation.',
      },
      {
        label: 'Local',
        title: 'Connect your own app',
        description:
          'Local apps can be connected to Nimi for team testing, personal tools, or work that is not ready for a public release yet.',
      },
    ],
    notes: [
      'New product work uses the Nimi Apps path.',
      'The homepage does not promise a public app catalog before it opens; the product UI shows what users can open today.',
      'To build an app, start with the SDK and Desktop docs.',
    ],
  },
  faq: {
    eyebrow: 'FAQ',
    title: 'Common questions',
    description:
      'Quick answers for builders and product readers — read the docs for the full picture.',
    communityCta: 'Join Discord',
    items: [
      {
        question: 'What is Nimi?',
        answer:
          'An open-source AI runtime built around persistent worlds and embodied agents. Compose capabilities, conversations, and shared memory through one typed SDK.',
      },
      {
        question: 'How do I start integrating?',
        answer:
          'Read the SDK docs, install the typed client, and connect to the runtime locally or in your own cloud — same SDK, same contracts.',
      },
      {
        question: 'Can AI capabilities run locally?',
        answer:
          'Yes. An owner can express Local capability intent, and Runtime can execute with admitted assets on the machine without changing the App request shape.',
      },
      {
        question: 'Is Nimi open source?',
        answer:
          'Yes. Runtime and SDK ship under Apache-2.0; desktop and app-layer code under MIT. The full source tree is on GitHub.',
      },
      {
        question: 'Desktop vs Web mode?',
        answer:
          'Desktop is the full app — embedded runtime, local AI, native shell. Web mode runs the same shell with web-only adapters for browser-only sessions.',
      },
      {
        question: 'Can I build my own Nimi App?',
        answer:
          'Yes. Developers can start from the SDK and Desktop docs, then connect tools, scenes, or local AI experiences to Nimi through the Nimi Apps path.',
      },
    ],
  },
  security: {
    title: 'Open rules. Clear boundaries.',
    subtitle: 'Users know what they are using. Developers know where to integrate.',
    intro:
      'Nimi keeps the runtime, SDK, desktop app, and app layer separate: public entry points are documented, and private internals stay protected.',
    pillars: [
      {
        label: 'Public rules',
        title: 'Core rules live in the repo',
        points: [
          'Public product rules live under .nimi/spec/**, where they can be read and reviewed.',
          'Docs and landing copy follow the same source, so the story does not drift.',
        ],
      },
      {
        label: 'Clear integration',
        title: 'Use the public interfaces',
        points: [
          'Developers integrate through the SDK, Desktop, and documented entry points.',
          'Apps do not need private internals or hidden shortcuts to work inside Nimi.',
        ],
      },
      {
        label: 'Trusted catalog',
        title: 'Capability and implementation data comes from source',
        points: [
          'Runtime implementation and capability information is generated from source tables.',
          'The page favors traceable facts over broad marketing promises.',
        ],
      },
    ],
  },
  openSource: {
    title: 'Open source. End to end.',
    subtitle: 'Read the runtime. Read the SDK. Read the spec.',
    description:
      'Nimi ships under permissive licenses across the runtime, SDK, and app layers — built on contracts you can read, fork, and extend.',
    githubCta: 'View on GitHub',
    docsCta: 'Read Docs',
    roadmapCta: 'Read Roadmap',
    proofItems: [
      {
        label: 'Runtime + SDK',
        value: 'Apache-2.0',
        detail:
          'Core runtime and SDK are open and inspectable — clone, build, and run them locally.',
        icon: 'runtime',
      },
      {
        label: 'Apps',
        value: 'MIT',
        detail: 'Desktop and app-layer code ships with permissive licensing — fork, ship, embed.',
        icon: 'apps',
      },
      {
        label: 'Contracts',
        value: 'Public',
        detail: 'Managed cloud surfaces stay visible through the public SDK boundary.',
        icon: 'contracts',
        featured: true,
      },
    ],
  },
  footer: {
    line1: 'Open-source AI runtime for apps. One CLI, one SDK, local and cloud AI.',
    line2: 'Read the docs to see what ships today and what is on the roadmap.',
    termsLabel: 'Terms',
    privacyLabel: 'Privacy',
  },
  localeToggleLabel: 'Language',
  localeOptions: {
    en: 'English',
    zh: '中文',
    switchToEn: 'Switch language to English',
    switchToZh: 'Switch language to Chinese',
  },
};
