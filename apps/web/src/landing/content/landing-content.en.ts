import { createPreviewTranslate } from '../i18n/preview-messages.js';
import { createRemainingAppPreviewContent } from './landing-content.remaining-apps.js';
import { appPreviewMessagesEn } from './app-preview-messages.en.js';
import type { LandingContent } from './landing-content.js';
import { createZhiyuPreviewContent } from './landing-content.zhiyu.js';
import { createShijingPreviewContent } from './landing-content.shijing.js';
import { createParentosPreviewContent } from './landing-content.parentos.js';
import { createStorybookPreviewContent } from './landing-content.storybook.js';
import { createOddBureauPreviewContent } from './landing-content.odd-bureau.js';
import { createJevSearchPreviewContent, createJevUltrafastPreviewContent, createMoneyPrinterPreviewContent, createOpenwhisprPreviewContent, createVideoLingoPreviewContent, createVoiceStudioPreviewContent } from './landing-content.third-party.js';

const t = createPreviewTranslate(appPreviewMessagesEn);

export const landingContentEn: LandingContent = {
  skipToContent: 'Skip to main content',
  nav: {
    apps: 'Apps',
    worlds: 'Characters & Worlds',
    create: 'Create apps',
    developers: 'Developers',
    docs: 'Docs',
    discord: 'Discord',
    menu: 'Page navigation',
    openMenu: 'Open navigation menu',
    closeMenu: 'Close navigation menu',
  },
  hero: {
    slogan: 'Make AI truly yours',
    sloganAccent: 'truly yours',
    subSlogan: "Local-first, with the freedom of cloud compute.\nPurpose-built apps and immersive worlds for your personal AI workstation.",
    subSloganNote: 'Continue the conversation with the same LocalAgent across authorized apps.',
    downloadCta: "Download Public Beta",
    downloadNote: "Public Beta for Apple Silicon Macs and Windows x86_64. A Nimi account is required.",
    docsCta: 'View docs',
    demo: {
      windowTitle: 'Nimi',
      nav: { chat: 'Chat', explore: 'Explore', apps: 'Apps', runtime: 'Runtime', settings: 'Settings' },
      chat: {
        greeting: 'Hi, Halliday! Where shall we begin today?',
        inputPlaceholder: 'Ask your AI companion…',
        inputNote: 'Interactive preview; real conversations take place inside the Nimi desktop app.',
        sendLabel: 'Send',
        backLabel: 'Back',
        userName: 'Halliday',
        defaultTargetId: 'agent-a',
        scriptedReply: 'This is a sample reply demonstrating UI flow; real responses are generated live by the Nimi desktop app.',
        dateLocale: 'en-US',
        dateLabels: { today: 'Today', yesterday: 'Yesterday' },
        copy: {
          bubbleUserLabel: 'You',
          bubbleAssistantLabel: 'Agent',
          markdownCopyLabel: 'Copy',
          markdownCopiedLabel: 'Copied',
          typingAgentRoleLabel: 'Agent',
          typingThinkingLabel: 'Thinking',
          typingStopLabel: 'Stop',
        },
        agents: [
          {
            id: 'agent-a',
            name: 'Echo',
            initial: 'E',
            messages: [
              { id: 'a-m1', role: 'user', text: 'Take a look at the outline for Chapter 3 of Deep Space Messenger. When should the gravity anchor foreshadowing pay off?', minutesAgo: 8 },
              { id: 'a-m2', role: 'assistant', text: 'Right as the vessel traverses the asteroid ring. What looks like an ordinary telemetry spike is actually a directed beacon from the fallen civilization—it keeps the pacing restrained and haunting.', minutesAgo: 7 },
              { id: 'a-m3', role: 'user', text: 'Love that direction. Let’s tighten the emotional cadence of these scenes.', minutesAgo: 6 },
              { id: 'a-m4', role: 'assistant', text: 'I’ve restructured a beat-by-beat rhythm draft focusing on the communications officer’s internal monologue. It’s ready in your workspace whenever you want to inspect it.', minutesAgo: 5 },
            ],
          },
          {
            id: 'agent-e',
            name: 'Hoshino',
            initial: 'H',
            messages: [
              { id: 'e-m1', role: 'assistant', text: 'Welcome back! For that rainy-night piano motif you saved, I sketched two arrangement directions. Want to preview them?', minutesAgo: 1560 },
              { id: 'e-m2', role: 'user', text: 'Let’s listen to the textured, lo-fi sketch first.', minutesAgo: 1558 },
            ],
          },
          {
            id: 'agent-k',
            name: 'Kael',
            initial: 'K',
            messages: [
              { id: 'k-m1', role: 'assistant', text: 'Your three reading notes on local LLM quantization from this week are organized, with the key takeaways ready to review.', minutesAgo: 3000 },
            ],
          },
        ],
      },
      explore: {
        title: 'Explore',
        searchPlaceholder: 'Search characters, worlds, and apps',
        sections: [
          {
            label: 'Characters',
            items: [
              { name: 'Echo', meta: 'Narrative Guide · Demo Character' },
              { name: 'Hoshino', meta: 'Music Partner · Demo Character' },
            ],
          },
          { label: 'Worlds', items: [{ name: 'Oasis Zero', meta: 'Sci-Fi World · Demo World' }] },
          {
            label: 'Apps',
            items: [
              { name: 'ParentOS', meta: 'Private child growth journal & family records' },
              { name: 'Nimi Overtone', meta: 'Music playground for ideas and arrangement' },
            ],
          },
        ],
      },
      apps: {
        title: 'Apps',
        countSuffix: ' Apps',
        searchPlaceholder: 'Search apps or App IDs',
        backLabel: 'Back to app library',
        launchLabel: 'Launch',
        tabs: ['Overview', 'Nimi Access', 'AI Models'],
        tabPlaceholderNote: "This panel isn’t populated with demo data.",
        aboutTitle: 'About',
        updatedLabel: 'Recently updated',
        moreInfoLabel: 'More info',
        previewBadge: 'Interactive Preview · Demo Data',
        previewUnavailableTitle: 'Preview not available',
        previewUnavailableBody: 'An interactive preview is not available for this app yet. Please pick another app from the catalog.',
        closeLabel: 'Close',
        items: [
          { id: 'nimi.zhiyu', name: 'Zhiyu', task: 'Nurture your local AI companion: personal conversation, evolving traits, and shared growth.', tags: ['Text Generation', 'Voice Synthesis'], updatedAt: 'September 17, 2026', localDev: true },
          { id: 'nimi.parentos', name: 'ParentOS', task: "Keep your child’s growth journal and family milestones private, stored entirely on your local disk.", tags: ['Text Generation', 'Voice Transcription'], updatedAt: 'September 15, 2026', localDev: true, iconSrc: '/demo/parentos-icon.png' },
          { id: "io.github.nimiplatform.jev-search", name: "Jev Search", task: "Search the web in plain language, filter trusted sources, and organize relevant references.", tags: ["Search","Re-ranking"], updatedAt: "October 12, 2026", localDev: true, iconSrc: '/demo/jev-search-icon.png' },
          { id: "io.github.nimiplatform.jev-ultrafast", name: "Jev Ultrafast", task: "Set a goal and let your browser read the page, make decisions, and run multi-step workflows.", tags: ["Browser Automation","Text"], updatedAt: "October 12, 2026", localDev: true, iconSrc: '/demo/jev-ultrafast-icon.png' },
          { id: "moneyprinterturbo.studio", name: "MoneyPrinterTurbo", task: "Turn text scripts into short-form videos with automated footage sourcing, AI voiceover, and subtitles.", tags: ["Text","Voice","Video"], updatedAt: "October 12, 2026", localDev: true, iconSrc: '/demo/moneyprinter-icon.png' },
          { id: "ai.nimi.openwhispr", name: "OpenWhispr", task: "Speak freely and transcribe rambling audio into clean, structured notes.", tags: ["Dictation","Notes","Search"], updatedAt: "October 12, 2026", localDev: true, iconSrc: '/demo/openwhispr-icon.png' },
          { id: "ai.nimi.videolingo", name: "VideoLingo", task: "Bring your videos into new languages with transcription, subtitle review, translation, and dubbing.", tags: ["Transcription","Translation","Dubbing"], updatedAt: "October 12, 2026", localDev: true, iconSrc: '/demo/videolingo-icon.png' },
          { id: "nimiplatform.voicestudio", name: "VoiceStudio", task: "Design a distinctive voice for stories, audiobooks, and cinematic narration.", tags: ["Voice Design","Speech","Transcription"], updatedAt: "October 12, 2026", localDev: true, iconSrc: '/demo/voicestudio-icon.png' },
          {"id":"nimi.overtone","name":"Nimi Overtone","task":"A playground for songwriters: turn imagery into multi-directional sketches, shape lyrics, and audition takes.","tags":["Music","Lyrics"],"updatedAt":"2026-10-13","localDev":true,"iconSrc":"/demo/overtone-icon.png"},
          { id: 'nimi.storybook', name: 'Storybook', task: "Read and write interactive branching stories where choices and distinct characters drive the plot.", tags: ['Text Generation'], updatedAt: 'September 10, 2026', localDev: false, iconSrc: '/demo/storybook-icon.png' },
          {"id":"nimi.realm-persona-studio","name":"Realm Persona Studio","task":"Craft your own Realm Personas—shape portraits, personality traits, and lore drafts.","tags":["Character Creation","Images"],"updatedAt":"2026-10-13","localDev":true,"iconSrc":"/demo/persona-studio-icon.png"},
          { id: 'nimi.shijing', name: 'ShiJing 时镜', task: 'Personal rhythm companion grounded in traditional solar-term calendars and cyclical self-observation.', tags: ['Text Generation'], updatedAt: 'September 5, 2026', localDev: true },
          { id: 'nimi.odd-bureau', name: 'Odd Bureau 奇物局', task: 'Snap a photo of an everyday desk item, and watch AI turn it into a playable, characterful micro-world.', tags: ['Vision Localization', 'Text Generation', 'Voice Synthesis'], updatedAt: 'September 18, 2026', localDev: true },
          {"id":"nimi.inscape","name":"Inscape 心相","task":"Self-discovery for adults, grounded in Jungian cognitive functions—with all reflections stored strictly on your device.","tags":["Self-Discovery","Daily Reflection"],"updatedAt":"2026-10-13","localDev":true,"iconSrc":"/demo/inscape-icon.png"},
          {"id":"nimi.polyagent","name":"PolyAgent","task":"Observe prediction markets, establish strategic constraints, and track hypotheses in a simulated ledger.","tags":["Market Analysis","Paper Trading"],"updatedAt":"2026-10-13","localDev":true,"iconSrc":"/demo/polyagent-icon.png"},
          {"id":"nimi.realm-world-studio","name":"Realm World Studio","task":"Build worlds from the ground up: shape geographies, social rules, and factions to stage living stories.","tags":["Worldbuilding","Character Creation"],"updatedAt":"2026-10-13","localDev":true,"iconSrc":"/demo/world-studio-icon.png"},
          {"id":"org.nimiplatform.deeptutor","name":"DeepTutor","task":"Interrogate technical papers and tough problems: deconstruct concepts, work through derivations, and keep notes.","tags":["Learning","Research","Notes"],"updatedAt":"2026-10-13","localDev":true,"iconSrc":"/demo/deeptutor-icon.png"},
          {"id":"openmontage.studio","name":"OpenMontage","task":"Move from script to final cut—assemble scripts, voice clips, and visual storyboards into edited narrative videos.","tags":["Storyboards","Video","Voice"],"updatedAt":"2026-10-13","localDev":true,"iconSrc":"/demo/openmontage-icon.png"},
          {"id":"org.nimiplatform.sillytavern","name":"SillyTavern","task":"Bring fictional casts to life with multi-character lorebooks, persona profiles, and long-context dialogue.","tags":["Character Chat","Lorebooks"],"updatedAt":"2026-10-13","localDev":true,"iconSrc":"/demo/sillytavern-icon.png"},
          {"id":"nimiplatform.vane","name":"Vane","task":"Dig into long-form literature and web sources to build research briefs with source references.","tags":["Search","Research"],"updatedAt":"2026-10-13","localDev":true,"iconSrc":"/demo/vane-icon.png"},
          {"id":"io.github.nimiplatform.next-ai-draw-io","name":"Next AI Draw.io","task":"Sketch complex system diagrams and process flows with natural language, then fine-tune them on an interactive canvas.","tags":["Diagrams","Text"],"updatedAt":"2026-10-13","localDev":true,"iconSrc":"/demo/drawio-icon.png"},
          {"id":"io.github.nimiplatform.open-notebook","name":"Open Notebook","task":"Weave documents, Q&A reflections, and podcast audio into an interconnected web of knowledge.","tags":["Document Research","Notes","Podcasts"],"updatedAt":"2026-10-13","localDev":true,"iconSrc":"/demo/open-notebook-icon.png"},
          {"id":"io.github.nimiplatform.presenton","name":"Presenton","task":"Turn rough bullet points into well-structured, beautifully typeset slide decks.","tags":["Presentations","Editor"],"updatedAt":"2026-10-13","localDev":true,"iconSrc":"/demo/presenton-icon.png"},
        ],
      },
      appPreview: {
        locale: 'en',
        messages: appPreviewMessagesEn,
        remainingApps: createRemainingAppPreviewContent(t),
        zhiyu: createZhiyuPreviewContent(t),
        shijing: createShijingPreviewContent(t),
        parentos: createParentosPreviewContent(t),
        storybook: createStorybookPreviewContent(t),
        oddBureau: createOddBureauPreviewContent(t),
        jevSearch: createJevSearchPreviewContent(t),
        jevUltrafast: createJevUltrafastPreviewContent(t),
        moneyPrinter: createMoneyPrinterPreviewContent(t),
        openwhispr: createOpenwhisprPreviewContent(t),
        videoLingo: createVideoLingoPreviewContent(t),
        voiceStudio: createVoiceStudioPreviewContent(t),
      },
      runtime: {
        title: 'Runtime',
        subtitle: "Local runtime and model status · sample data",
        groups: [
          { label: 'Service', rows: [{ label: 'Runtime status', value: 'Running' }, { label: 'Version', value: 'Preview build' }] },
          { label: "Models", rows: [{ label: 'Local models', value: '1 ready' }, { label: 'Cloud connections', value: '2' }] },
          { label: 'Data', rows: [{ label: 'Data folder', value: 'This device' }] },
        ],
      },
      settings: {
        title: 'Settings',
        groups: [
          { label: 'Account', rows: [{ label: 'Profile', value: 'Halliday' }, { label: 'Language', value: 'English' }] },
          { label: 'Appearance', rows: [{ label: 'Theme', value: 'Light' }, { label: 'Density', value: 'Comfortable' }] },
          { label: 'Notifications', rows: [{ label: 'Desktop notifications', value: 'On' }, { label: 'Sounds', value: 'Off' }] },
          { label: 'About', rows: [{ label: 'Version', value: 'Preview build' }] },
        ],
      },
    },
  },
  apps: {
    title: 'AI shouldn’t be trapped in a generic chat box.',
    subtitle: "Nimi shapes AI into focused, privacy-respecting local applications.",
  },
  worlds: {
    title: 'Meet living characters. Step into their worlds.',
    subtitle: 'Beyond stateless prompts: characters with coherent memory, and worlds with persistent history and laws.',
    body: 'Start a conversation to discover a character’s inner life and the world they inhabit. Come with a real problem to solve, or simply catch up with an old acquaintance.',
    exampleTitle: 'A typical journey',
    exampleSteps: [
      'Choose a character that sparks your curiosity.',
      "Begin a conversation and explore how they see their world.",
      'Continue the dialogue, or visit the world directory to see who else lives there.',
    ],
    cta: 'Explore characters & worlds',
  },
  capabilities: {
    title: 'Local when you want it. Cloud when you need it.',
    subtitle: 'Balance privacy, computational muscle, and cost according to the task at hand.',
    tasks: [
      {
        id: 'writing',
        title: 'Writing & Restructuring',
        description: 'Draft, reshape, and distill scattered thoughts into cohesive prose.',
      },
      {
        id: 'image',
        title: 'Visual Creation',
        description: "Generate, refine, and iterate on visual assets for your stories and tools.",
      },
      {
        id: 'media',
        title: 'Audio & Video',
        description: 'Transcribe recordings, align bilingual subtitles, and isolate audio tracks.',
      },
      {
        id: 'music',
        title: 'Musical Ideation',
        description: 'Generate melodic ideas, structure lyrics, and compare arrangement takes.',
      },
      {
        id: 'conversation',
        title: 'Living Conversation',
        description: "Converse through text or expressive voice, with natural interruption on supported realtime routes.",
      },
      {
        id: 'vision',
        title: 'Spatial & Visual Grounding',
        description: "Identify targets and coordinates in images to drive automated tasks.",
      },
    ],
    localTitle: 'Local AI (Offline-First)',
    localText: "Run models directly on your hardware with zero cloud inference fees. Available models depend on your device, while sign-in, downloads, and online features still require network access.",
    cloudTitle: 'Cloud AI (Connected)',
    cloudText: 'Connect leading cloud models on demand for complex reasoning, high-fidelity generation, and heavy multimodal workloads.',
    costNote: "Nimi is free and open source. Cloud services follow their providers’ pricing, and third-party app pricing is set by each publisher.",
    cta: 'Learn about model requirements',
  },
  create: {
    title: 'Turn your ideas into your own private tools.',
    subtitle: "Build local AI apps tailored to your workflows and daily routines.",
    body: "Start with a clear need: what your app takes in, how it reasons, and what output you expect. Wire up the AI capabilities you need and make it work your way.",
    steps: [
      {
        title: 'Define the task',
        description: 'Clarify what the app processes, its decision flow, and the desired outcome.',
      },
      {
        title: 'Scaffold the project',
        description: 'Generate a clean project skeleton in seconds with the Nimi App Tools CLI.',
      },
      {
        title: 'Connect the SDK',
        description: 'Call typed local or cloud AI capabilities while focusing on your UI and interaction.',
      },
      {
        title: 'Run & iterate locally',
        description: "Preview and hot-reload in the desktop host until every detail fits.",
      },
    ],
    caveat: "Building apps currently requires standard web and TypeScript tooling—visual no-code creation isn’t available yet.",
    cta: 'Learn how to build a Nimi App',
  },
  continuity: {
    title: 'Switch apps, keep the understanding.',
    subtitle: 'The same LocalAgent travels with you across authorized apps. Memory is stored on your machine, separately for each agent.',
    body: "With memory enabled, relevant memories can inform future interactions. If you use cloud inference, relevant context may be included in requests sent to that provider.",
    supports: ['App access follows the current authorized session.', 'Different agents keep separate memory.'],
  },
  developers: {
    eyebrow: 'For Developers',
    title: 'Bring your applications into the Nimi ecosystem.',
    subtitle: 'Use the unified Nimi SDK to invoke local and cloud AI models through a protected desktop host session.',
    body: 'Explore hands-on guides, comprehensive API references, and working examples to start building.',
    points: [
      'Typed Nimi SDK: One clean API across multiple local and cloud model providers.',
      'Practical guides: Step-by-step documentation from scaffolding to your first AI response.',
      'Modern scaffolding: Bootstrap with app-tools and iterate with frontend hot reload.',
    ],
    primaryCta: 'Read developer guides',
    secondaryCta: 'View GitHub repository',
  },
  getStarted: {
    title: 'Begin your personal AI journey.',
    subtitle: "Try the Public Beta, discover ecosystem apps, or meet an AI companion. Start with what you want to achieve today.",
    primaryCta: "Download Public Beta",
    availability: "Public Beta is available for Apple Silicon Macs and Windows x86_64. Using Nimi requires a Nimi account and browser sign-in.",
    secondaryCta: 'Explore all apps',
  },
  footer: {
    line1: 'MAKE AI TRULY YOURS',
    line2: 'Discover applications, meet living AI characters, and explore shared worlds.',
    navLabel: 'Pages',
    appsLabel: 'Apps',
    worldsLabel: 'Characters & Worlds',
    createLabel: 'Create apps',
    developersLabel: 'Developers',
    docsLabel: 'Docs',
    githubLabel: 'GitHub',
    downloadLabel: 'Download status',
    codeSigningLabel: 'Code signing policy',
    securityLabel: 'Security report',
    termsLabel: 'Terms of Service',
    privacyLabel: 'Privacy Policy',
  },
  localeToggleLabel: 'Language',
  localeOptions: {
    en: 'English',
    zh: '中文',
    switchToEn: 'Switch language to English',
    switchToZh: 'Switch language to Chinese',
  },
};
