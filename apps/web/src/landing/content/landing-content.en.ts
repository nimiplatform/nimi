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
    eyebrow: 'What you can do',
    title: 'One home for your AI life.',
    subtitle:
      'Conversations, characters, creations, and worlds no longer live in separate apps. In Nimi they come together in one personal space—connected, persistent, and yours.',
    cards: [
      {
        id: 'talk',
        label: 'Talk',
        title: 'Conversations that stay with you',
        description:
          'Chat with characters who keep their personality and remember your history—not stateless bots that reset every session.',
        scenario: 'Maya picks up yesterday’s conversation right where you left it—in her own voice.',
        points: [
          'Characters with persistent identity',
          'Text and voice',
          'Runs locally or in the cloud',
        ],
      },
      {
        id: 'create',
        label: 'Create',
        title: 'Create with your cast',
        description:
          'Give your characters a face and a voice. Generate images, video, speech, and music with the AI providers you choose, without leaving Nimi.',
        scenario: 'Sketch a companion, give her a voice, and let her star in the story you write together.',
        points: [
          'Image, video, voice, and music',
          'Your characters, your style',
          'You pick the AI provider',
        ],
      },
      {
        id: 'explore',
        label: 'Explore',
        title: 'Step into living worlds',
        description:
          'Enter persistent worlds where characters have lives of their own. One identity travels with you across every world and story.',
        scenario: 'The world keeps turning while you’re away. Come back to what changed.',
        points: [
          'Worlds that keep evolving',
          'One identity, many worlds',
          'Stories that continue',
        ],
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
    kicker: 'Your AI, your choice',
    title: 'Works with the AI you already use.',
    subtitle:
      'Nimi speaks one capability language; Runtime routes each request to the provider you choose—dozens of cloud services, or models running on your own device.',
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
      'Nimi Apps defines the catalog, local-import, installation, update, launch, repair, uninstall, and Developer Mode lifecycle contract. This pre-release exposes Developer Mode local development; public catalog, local import, ordinary install, installed launch, publisher publication, and registry onboarding are not available yet.',
      'The public app catalog has not opened; Nimi only shows what you can actually open today.',
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
          'Not yet. No stable Nimi release is currently published: Windows signing is still pending and only unsigned developer previews exist. Watch GitHub or join Discord to hear the moment a stable build lands.',
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
