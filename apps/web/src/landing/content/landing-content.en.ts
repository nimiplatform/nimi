import type { LandingContent } from './landing-content.js';

const EN_TAB_LOCAL = `import { Runtime } from '@nimiplatform/sdk/runtime';

const runtime = new Runtime();

const result = await runtime.generate({
  prompt: 'Explain quantum computing simply.',
});

console.log(result.text);`;

const EN_TAB_CLOUD = `import { Runtime } from '@nimiplatform/sdk/runtime';

const runtime = new Runtime();

const result = await runtime.generate({
  provider: 'gemini',
  prompt: 'Write a haiku about open source.',
});

console.log(result.text);`;

const EN_TAB_STREAMING = `import { Runtime } from '@nimiplatform/sdk/runtime';

const runtime = new Runtime();

const stream = await runtime.stream({
  prompt: 'Tell me a story about a robot.',
});

for await (const chunk of stream) {
  process.stdout.write(chunk.text);
}`;

const EN_TAB_WORKFLOW = `import { Runtime } from '@nimiplatform/sdk/runtime';

const runtime = new Runtime();

const draft = await runtime.generate({
  prompt: 'Draft a product launch summary.',
});

const polish = await runtime.generate({
  provider: 'gemini',
  prompt: \`Polish this summary for a blog post:\n\n\${draft.text}\`,
});

console.log(polish.text);`;

export const landingContentEn: LandingContent = {
  localeName: 'English',
  skipToContent: 'Skip to main content',
  nav: {
    install: 'Install',
    sdk: 'SDK',
    catalog: 'Catalog',
    architecture: 'Architecture',
    desktop: 'Desktop',
    security: 'Security',
    mods: 'Mods',
    openSource: 'Open Source',
    discord: 'Discord',
  },
  hero: {
    eyebrow: 'Early Access — Install in seconds',
    title: 'Local + cloud AI',
    titleAccent: '',
    title2: ' in ',
    titleAccent2: 'one runtime',
    subtitle: 'One CLI and one SDK to run any model, anywhere.',
    description: 'Nimi is in early access. Core runtime, SDK, and desktop app are functional and open for use. APIs may change between releases.',
    primaryCta: 'Download Desktop',
    docsCta: 'Read the docs',
    helperPrefix: 'Or',
    helperDocsCta: 'Read Docs',
    helperGithubCta: 'View on GitHub',
    copyTooltipLabel: 'Copy command',
    copiedCommandLabel: 'Copied',
    githubCta: 'View on GitHub',
    previewLabel: 'Quickstart walkthrough',
    previewAlt: 'Nimi quickstart walkthrough',
    previewCaption: 'Install, start the runtime, and get a first answer from the CLI in one flow.',
    getStartedTitle: 'Get Started',
    getStartedSubtitle: 'Choose your install path',
    tabs: [
      { id: 'desktop', label: 'Desktop App', command: '', ctaText: 'Download Desktop App' },
      { id: 'curl', label: 'Terminal (curl)', command: 'curl -fsSL https://install.nimi.xyz | sh', ctaText: 'Copy Command' },
      { id: 'npm', label: 'npm', command: 'npm install -g @nimiplatform/nimi', ctaText: 'Copy Command' },
    ],
    terminalMockupTitle: 'Walkthrough',
  },
  architecture: {
    title: 'The Unified Architecture.',
    subtitle: 'Project Overview',
    description:
      'Nimi is building shared infrastructure for the next generation of AI apps, with one runtime surface for developers and one coherent experience for users.',
    devTitle: 'For developers',
    devText:
      'Use the SDK and runtime to unify model access, orchestration, and app integration without stitching together incompatible vendor surfaces.',
    userTitle: 'For users',
    userText:
      'Move between AI apps with a more consistent runtime, shared identity, and less repeated setup across products built on Nimi.',
    conclusion: 'One platform, with clear boundaries between app, runtime, and realm.',
    slogan: 'Infrastructure for next-generation AI apps.',
  },
  modelCatalog: {
    kicker: 'Model coverage',
    title: 'The live model catalog',
    subtitle: 'Search one runtime surface across local and cloud model coverage.',
    overview: {
      searchPlaceholder: 'search 38 cloud providers and infinite models…',
      cloudProvidersLabel: 'Cloud Providers',
      localModelsLabel: 'Local Models',
      modalitiesLabel: 'Modalities',
      modalitiesValue: 'OMNI',
      modalitiesDescription: 'Text / TTS / STT / Video / Image / Embeddings',
      industryLeadersLabel: 'Supported by industry leaders',
      shortcutLabel: 'Ctrl K',
      clearSearchLabel: 'Clear',
      matchingProvidersLabel: 'matching providers',
      liveCatalogLabel: 'Live catalog',
    },
    liveBadge: 'From runtime catalog',
    featuredProvidersLabel: 'Featured providers',
    featuredProviders: ['OpenAI', 'Anthropic', 'Gemini', 'xAI', 'DashScope', 'Volcengine', 'Mistral', 'DeepSeek'],
    stats: {
      providers: 'providers',
      models: 'models',
      cloudProviders: 'cloud providers',
      localModels: 'local models',
    },
    localTitle: 'Offline / local',
    localHeadline: 'On-device voice and speech models are already in the stack.',
    localDescription:
      'Current local catalog coverage spans voice, image, and video: Qwen3-TTS, CosyVoice2, GPT-SoVITS, F5-TTS, Piper, Kokoro for speech — plus Nimi Media for local image generation (FLUX) and video generation (Wan2.1) through the same runtime surface.',
    capabilitiesTitle: 'Capability spread',
    capabilitiesHeadline: 'Text, embeddings, image, video, TTS, and STT in one runtime.',
    capabilitiesDescription:
      'This is where the landing page starts to look credible: frontier text models, image generators, video systems, and speech models all show up in the same catalog.',
    capabilityLabels: {
      'text.generate': 'Text / reasoning',
      'text.embed': 'Embeddings',
      'image.generate': 'Image',
      'video.generate': 'Video',
      'audio.synthesize': 'Speech / TTS',
      'audio.transcribe': 'Transcription / STT',
    },
    capabilityCountLabel: 'catalog entries',
    cloudBadge: 'cloud',
    matrixTitle: 'Cloud matrix',
    matrixHeadline: 'Every provider, with actual model ids.',
    matrixDescription:
      'No hand-wavy “supports OpenAI-compatible models” claim here. These are the concrete model ids currently represented in the runtime catalog.',
    providerDetailSuffix: 'models live in this provider bucket',
    searchResultsTitle: 'Search results from the live catalog',
    searchResultsDescription: 'Show matching providers with capability and model ids directly instead of keeping the full matrix visible.',
    noResultsTitle: 'No providers match this search.',
    noResultsDescription: 'Try a provider name like OpenAI, Gemini, or DashScope, or search for a model id.',
    sourceNote:
      'Source of truth: runtime/catalog/providers/*.yaml in this repository. Snapshot reflected here was derived on March 10, 2026.',
  },
  sdk: {
    title: 'One SDK. Multiple ways to run AI.',
    subtitle: 'Start local, add cloud when you need it, and keep the integration surface stable.',
    tabs: [
      { label: 'Walkthrough', snippet: EN_TAB_LOCAL, caption: 'Go from install to first answer fast.' },
      { label: 'Multimodal', snippet: EN_TAB_CLOUD, caption: 'Handle text, image, and speech in one flow.' },
      { label: 'Stream Job', snippet: EN_TAB_STREAMING, caption: 'Run streaming jobs through the same runtime.' },
      { label: 'Workflow', snippet: EN_TAB_WORKFLOW, caption: 'Chain steps into one repeatable AI workflow.' },
    ],
    previewLabel: 'SDK walkthrough',
    previewAlt: 'Nimi SDK walkthrough',
    previewCaption: 'Install the SDK, start the runtime, and send local and cloud requests from the same app flow.',
    multimodalLabel: 'Beyond text',
    multimodalAlt: 'Nimi multimodal walkthrough',
    multimodalCaption: 'The same runtime also handles image and speech flows when you move beyond text-only examples.',
    callout: 'Start with one setup. Expand without rewriting.',
  },
  desktop: {
    title: 'Desktop Workspace for AI',
    subtitle: 'Run models, chat, and manage mods from one desktop workspace.',
    screenshotAlt: 'Nimi desktop app preview',
    features: [
      { icon: 'dashboard', title: 'Runtime Dashboard', description: 'See health, model status, and resource usage at a glance.' },
      { icon: 'chat', title: 'Built-in Chat', description: 'Talk to local and cloud models from the same workspace.' },
      { icon: 'mods', title: 'Mod Host', description: 'Launch installed mods without leaving the desktop app.' },
      { icon: 'models', title: 'Model Management', description: 'Install, update, and switch models from one place.' },
    ],
    downloadCta: 'Download Desktop App',
    availability: {
      eyebrow: 'Compatibility / Availability',
      items: [
        'Desktop releases publish macOS, Windows, and Linux assets on GitHub',
        'CLI + SDK work independently of the desktop app',
        'Local-first by default',
        'Realm remains optional',
        'Early access: APIs and interfaces may change between releases',
      ],
    },
  },
  faq: {
    eyebrow: 'FAQ',
    title: 'Common questions before you start',
    description: "Have a question that isn't answered here? Jump into the community and ask the core team directly.",
    communityCta: 'Join Nimi Discord',
    items: [
      {
        question: 'Do I need the desktop app to use Nimi?',
        answer: 'No. You can work directly with the runtime and SDK. Desktop is an additional workspace for chat, model management, and mods.',
      },
      {
        question: 'Can I run both local and cloud models through the same runtime?',
        answer: 'Yes. That is one of the core ideas behind Nimi: keep one runtime surface while switching between local execution and connected cloud providers.',
      },
      {
        question: 'What is open source and what is managed?',
        answer: 'The runtime, SDK, and desktop app are open source. Realm is an optional managed cloud layer, and its contracts are exposed publicly through the SDK.',
      },
      {
        question: 'How do mods fit into Nimi?',
        answer: 'Mods are runtime-native extensions and experiences that build on the same Nimi execution surface instead of bypassing it.',
      },
    ],
  },
  security: {
    title: 'Security by design',
    subtitle: 'Local-first execution, explicit boundaries, and controlled cloud access.',
    intro: 'Nimi is designed to keep execution paths, credentials, and extension access under clearer control.',
    pillars: [
      {
        label: 'Designed in',
        title: 'Clear system boundaries',
        points: ['Local and cloud paths are separated by design.', 'Cloud access routes through the runtime boundary.'],
      },
      {
        label: 'Built today',
        title: 'Controls already in place',
        points: [
          'Provider credentials stay on the runtime connector path, not in the desktop renderer.',
          'Mods and desktop surfaces are constrained by runtime-only routing and capability checks.',
        ],
      },
      {
        label: 'Hardening next',
        title: 'Still getting stronger',
        points: ['Runtime-side enforcement is still being tightened.', 'Mod policy, sandbox coverage, and audit visibility continue to improve.'],
      },
    ],
  },
  mods: {
    title: 'Extend with mods',
    subtitle: 'Pre-built apps powered by the Nimi runtime. Or build your own.',
    items: [
      { icon: 'chat', name: 'local-chat', description: 'Chat with local AI models. Private, fast, no network.' },
      { icon: 'sim', name: 'kismet', description: 'Economic simulation engine with real-time charts.' },
      { icon: 'audio', name: 'audio-book', description: 'Multi-voice audiobooks with AI narration.' },
      { icon: 'video', name: 'videoplay', description: 'Episode-scale video from narrative scripts.' },
      { icon: 'story', name: 'textplay', description: 'Interactive fiction with branching narratives.' },
      { icon: 'docs', name: 'knowledge-base', description: 'Document indexing and AI-powered search.' },
    ],
    buildModCta: 'Build your own mod',
  },
  openSource: {
    title: 'Open source at the core',
    subtitle: 'Built in the open. Ship with confidence.',
    description:
      'Nimi runtime, SDK, and desktop app are open source under Apache-2.0 and MIT. Realm is an optional managed cloud layer, and its contracts are public through the SDK.',
    githubCta: 'View on GitHub',
    docsCta: 'Read the docs',
  },
  finalCta: {
    title: 'Build on one AI runtime',
    description: 'Install Nimi, wire up the SDK, and keep local and cloud execution under one surface.',
    primaryCta: 'Read the docs',
    githubCta: 'View on GitHub',
  },
  footer: {
    line1: 'Nimi: Open-source AI runtime (Early Access)',
    line2: 'Licenses: Apache-2.0 (runtime/sdk), MIT (apps), CC-BY-4.0 (docs)',
    termsLabel: 'Terms of Service',
    privacyLabel: 'Privacy Policy',
  },
  localeToggleLabel: 'Language',
  localeOptions: {
    en: 'EN',
    zh: '中文',
  },
};
