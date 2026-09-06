import type { LandingContent } from './landing-content.js';

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
    experiences: 'Experiences',
    catalog: 'Your AI',
    desktop: 'Nimi Home',
    apps: 'Apps',
    sdk: 'Builders',
    security: 'Trust',
    faq: 'FAQ',
    docs: 'Docs',
    download: 'Download',
  },
  hero: {
    title: landingPositioningEn.hero.title,
    titleAccent: landingPositioningEn.hero.titleAccent,
    subtitle: landingPositioningEn.hero.subtitle,
    primaryCta: 'Get Nimi',
    secondaryCta: 'See what Nimi can do',
    proofPoints: ['Open source', 'Local-first', 'Choose your AI'],
  },
  experiences: {
    eyebrow: 'Beyond a single conversation',
    title: 'It remembers you, and has a rhythm of its own.',
    subtitle:
      'Conversations continue, and you control the memories. Turn on proactive companionship to let it reach out first.',
    cards: [
      {
        id: 'conversation',
        label: 'Continuing conversations',
        title: 'Pick up where you left off',
        description: 'Each companion keeps its own conversation. Come back and continue from last time.',
        scenario: 'No need to start with hello every time.',
        points: ['Revisit past conversations', 'Continue with the existing context', 'Text and voice supported'],
      },
      {
        id: 'memory',
        label: 'Memory management',
        title: 'You decide what stays',
        description: 'With memory enabled, you can inspect it, correct it, or ask it to forget.',
        scenario: 'Correct what is wrong. Delete what you no longer want to keep.',
        points: ['Inspect current memories', 'Correct inaccurate information', 'Forget one item or clear everything'],
      },
      {
        id: 'proactive-companion',
        label: 'Proactive companionship',
        title: 'Let it speak first this time',
        description: 'Enable proactive companionship and keep Nimi running. Your companion will reach out according to your settings.',
        scenario: 'Pause whenever you want some quiet.',
        points: ['Adjust how proactive it is', 'Greetings after time apart', 'Control daily and per-interaction usage'],
      },
    ],
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
    title: 'Your AI, your choice',
    subtitle:
      'Cloud models, local models—use whichever you like, switch anytime',
    overview: {
      searchPlaceholder: 'Search providers and capabilities',
      cloudProvidersLabel: 'Cloud providers',
      localModelsLabel: 'Local models',
      modalitiesLabel: 'Capabilities',
      modalitiesDescription: 'Text · Embeddings · Image · Video · Audio · Music · Voice · World',
      shortcutLabel: '⌘K',
      clearSearchLabel: 'Clear',
      matchingProvidersLabel: 'matching catalog entries',
      liveCatalogLabel: 'Live catalog',
      supportedByLabel: 'Provider families',
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
      'Try a provider or capability name.',
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
    eyebrow: 'For builders',
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
    matrixTitle: 'The full SDK surface, scannable.',
    matrixSubtitle:
      'Every SDK capability area, with a direct link into the reference docs.',
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
      runtime: 'AI engine',
      workspace: 'Workspace',
      capabilities: 'What runs where',
      localIntent: 'On this device',
      cloudIntent: 'In the cloud',
    },
    capabilitiesList: [
      { name: 'Chat & text', intent: 'local' },
      { name: 'Image creation', intent: 'cloud' },
      { name: 'Voice & speech', intent: 'local' },
    ],
    features: [
      {
        icon: 'dashboard',
        title: 'One calm overview',
        description: 'See active sessions, AI usage, and device load at a glance.',
      },
      {
        icon: 'chat',
        title: 'Chat, built in',
        description: 'Talk to people, AI assistants, and Nimi agents from the same window.',
      },
      {
        icon: 'models',
        title: 'Local AI, managed',
        description: 'Install and update on-device AI models from one place.'
      },
      {
        icon: 'apps',
        title: 'Apps in one place',
        description: 'Open available Nimi Apps and your connected local apps from one workspace.',
      },
    ],
    downloadCta: 'View download status',
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
      'Nimi Apps has separate Registry-approved package, explicit immutable local-package import, and Developer Mode paths. This pre-release supports verified Catalog discovery, installation, launch and uninstall on Windows x86_64, plus local development. The local-package import entry, other-platform package lifecycle, update and repair remain unavailable.',
      'Catalog actions reflect the current platform and Runtime state; an installed App and its Nimi access are separate facts.',
      'To build an app, start with the SDK and Nimi App docs.',
    ],
  },
  faq: {
    eyebrow: 'FAQ',
    title: 'Common questions',
    description:
      'What people usually ask before they dive in—the docs have the full picture.',
    communityCta: 'Join Discord',
    items: [
      {
        question: 'What is Nimi?',
        answer:
          'Nimi is an open-source, local-first personal AI product—one home where you talk, create, meet characters, and explore worlds, with the freedom to use local or cloud AI.',
      },
      {
        question: 'Can I download Nimi today?',
        answer:
          'No stable Nimi release or installer is currently published. The explicitly unsigned portable Windows x64 Runtime bootstrap v0.2.2-preview.1 is available for bootstrap testing, but it is not Nimi Home or a production install. See Download for the exact scope.',
      },
      {
        question: 'Is my data private?',
        answer:
          'Nimi is local-first: conversations and AI work can run entirely on your own device with local models. Cloud providers are only used when you choose them.',
      },
      {
        question: 'Which AI providers does Nimi work with?',
        answer:
          'Dozens of cloud providers—OpenAI, Anthropic, Gemini, DeepSeek, and more—plus models that run fully on your own machine. You choose per capability, and Runtime executes your choice.',
      },
      {
        question: 'Is Nimi open source?',
        answer:
          'Yes. Runtime and SDK ship under Apache-2.0; the app layer ships under MIT. The full source tree is on GitHub.',
      },
      {
        question: 'I’m a developer. Where do I start?',
        answer:
          'Start with the SDK docs and the Developer Mode local-development path: scaffold a Nimi App locally and build against the typed SDK. Public catalog distribution is not open yet.',
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
          'The public unsigned Runtime bootstrap is available at v0.2.2-preview.1; the SignPath Foundation application has not yet been submitted.',
          'No current Nimi artifact should be treated as SignPath-signed without valid Authenticode verification.',
        ],
      },
    ],
    statuses: [
      {
        label: 'Windows',
        value: 'Unsigned Runtime bootstrap v0.2.2-preview.1 available; signed RC and Stable pending',
      },
      {
        label: 'SignPath Foundation',
        value: 'Application not submitted; bootstrap prerequisite published',
      },
    ],
    links: [
      { label: 'Download', detail: 'Stable and unsigned-preview status', href: '/download' },
      { label: 'Unsigned Runtime preview', detail: 'v0.2.2-preview.1 · not promotable', href: 'https://github.com/nimiplatform/nimi/releases/tag/v0.2.2-preview.1' },
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
