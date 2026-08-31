import type { LandingContent } from './landing-content.js';

const EN_SPEC_NOTE = `Authority: .nimi/spec/**
Docs: /docs/reference/spec-map
Boundary: public projection, not independent truth`;

export const landingPositioningEn = {
  hero: {
    title: 'Make AI',
    titleAccent: 'truly yours.',
    subtitle:
      'Talk, create, and explore in Nimi—where your conversations, characters, creations, and worlds come together in one personal space.',
  },
  desktop: {
    title: 'Nimi, closer to you.',
    description:
      'Bring your conversations, creations, characters, and worlds together in one seamless desktop experience.',
  },
} as const;

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
    security: 'Trust',
    openSource: 'Source',
    faq: 'FAQ',
  },
  hero: {
    eyebrow: 'Open-source · Local-first · Installable personal AI',
    title: landingPositioningEn.hero.title,
    titleAccent: landingPositioningEn.hero.titleAccent,
    subtitle: landingPositioningEn.hero.subtitle,
    primaryCta: 'Get Nimi',
    secondaryCta: 'See what Nimi can do',
    proofPoints: ['Open source', 'Local-first', 'Choose your AI'],
  },
  architecture: {
    title: 'One Nimi, many possibilities.',
    subtitle: 'How Nimi comes together',
    description:
      'Nimi brings personal AI experiences into one product. Realm keeps ecosystem identity consistent, while Runtime runs AI capabilities locally or in the cloud.',
    devTitle: 'For builders',
    devText:
      'Integrate through the typed SDK. Compose character-backed agents, capabilities, conversations, and memory while Runtime owns Local or Cloud implementation selection.',
    userTitle: 'For you',
    userText:
      'Talk, create, meet characters, and explore worlds without treating each experience as a separate product. Nimi brings them together through one home.',
    conclusion: 'One product, open by design, ready for many experiences.',
    slogan: 'Your AI. Your choices. Your Nimi.',
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
      'realtime.interact': 'Realtime interaction',
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
    title: landingPositioningEn.desktop.title,
    subtitle: landingPositioningEn.desktop.description,
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
    downloadCta: 'View download status',
    availability: {
      eyebrow: 'Release status',
      items: [
        'Windows release pending production code-signing approval',
        'Unsigned previews use explicit non-promotable vX.Y.Z-preview.N tags',
        'No stable Nimi release is currently published',
      ],
    },
  },
  apps: {
    eyebrow: 'Nimi Apps',
    title: 'Bring new abilities into Nimi.',
    subtitle:
      'Nimi Apps are small apps you can open inside Nimi. They can add tools, scenes, or local AI experiences. Nimi Home shows what is available for your account and local workspace; developers build with the SDK and ship through clear product rules.',
    cta: 'Read Nimi App docs',
    cards: [
      {
        label: 'Use',
        title: 'Open apps in one place',
        description:
          'Use the Apps area in Nimi Home to open the tools, scenes, or local AI experiences that are available in your current product context.',
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
      'Nimi Apps owns catalog discovery, ordinary install with download progress, update, launch and run, repair, uninstall, explicit local import, and Developer Mode entry.',
      'The homepage does not promise a public app catalog before it opens; the product UI shows what users can open today.',
      'To build an app, start with the SDK and Nimi App docs.',
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
          'Nimi is an open-source, local-first personal AI product—a single place to talk, create, meet characters, and explore worlds, with the freedom to use local or cloud AI.',
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
          'Yes. Runtime and SDK ship under Apache-2.0; Nimi app and app-layer code under MIT. The full source tree is on GitHub.',
      },
      {
        question: 'Nimi Home vs Web mode?',
        answer: 'Nimi Home is the primary product entry hosted by the current native shell. Web mode is a constrained browser projection and does not replace native or local Runtime behavior.',
      },
      {
        question: 'Can I build my own Nimi App?',
        answer:
          'Yes. Developers can start from the SDK and Nimi App docs, then connect tools, scenes, or local AI experiences to Nimi through the Nimi Apps path.',
      },
    ],
  },
  security: {
    title: 'Trust, security, and release integrity.',
    subtitle: 'Review the source, report concerns privately, and verify release status before downloading.',
    intro:
      'Nimi keeps public source, security reporting, release availability, and code-signing status directly accessible. Pending work stays visibly pending.',
    linksAriaLabel: 'Nimi trust and security links',
    pillars: [
      {
        label: 'Source and docs',
        title: 'Inspect how Nimi is built',
        points: [
          'Source code is public at github.com/nimiplatform/nimi.',
          'Product and developer documentation is published at docs.nimi.ai.',
        ],
      },
      {
        label: 'Security',
        title: 'Report concerns privately',
        points: [
          'Use GitHub Security Advisories for private vulnerability reports.',
          'Security email: security@nimi.ai.',
        ],
      },
      {
        label: 'Code signing',
        title: 'Verify the release, not the promise',
        points: [
          'Windows production signing and the SignPath Foundation application are pending.',
          'No current Nimi artifact should be treated as SignPath-signed without valid Authenticode verification.',
        ],
      },
    ],
    statuses: [
      {
        label: 'Windows',
        value: 'Windows release pending production code-signing approval',
      },
      {
        label: 'SignPath Foundation',
        value: 'SignPath Foundation application pending',
      },
    ],
    links: [
      { label: 'Download', detail: 'Stable and unsigned-preview status', href: '/download' },
      { label: 'Code signing policy', detail: 'Scope, controls, and verification', href: '/code-signing' },
      { label: 'Source code', detail: 'github.com/nimiplatform/nimi', href: 'https://github.com/nimiplatform/nimi' },
      { label: 'Documentation', detail: 'docs.nimi.ai', href: 'https://docs.nimi.ai' },
      { label: 'GitHub Security Advisories', detail: 'Private vulnerability report', href: 'https://github.com/nimiplatform/nimi/security/advisories/new' },
      { label: 'security@nimi.ai', detail: 'Private security email', href: 'mailto:security@nimi.ai' },
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
    line1: `${landingPositioningEn.hero.title} ${landingPositioningEn.hero.titleAccent}`,
    line2: 'Read the docs to see what ships today and what is on the roadmap.',
    termsLabel: 'Terms',
    privacyLabel: 'Privacy',
    downloadLabel: 'Download',
    codeSigningLabel: 'Code signing policy',
    securityLabel: 'Security',
  },
  localeToggleLabel: 'Language',
  localeOptions: {
    en: 'English',
    zh: '中文',
    switchToEn: 'Switch language to English',
    switchToZh: 'Switch language to Chinese',
  },
};
