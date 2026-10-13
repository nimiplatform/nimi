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
    slogan: 'Your AI, Your way.',
    sloganAccent: 'Your way.',
    subSlogan: 'Local or cloud, the model is yours to choose.\nThe character is yours to shape, the apps and worlds yours to open.',
    subSloganNote: 'Continue with the same AI in the apps you authorize.',
    downloadCta: 'Check download status',
    downloadNote: 'Not available to install yet. Using Nimi requires a Nimi account.',
    docsCta: 'View docs',
    demo: {
      windowTitle: 'Nimi',
      nav: { chat: 'Chat', explore: 'Explore', apps: 'Apps', runtime: 'Runtime', settings: 'Settings' },
      chat: {
        greeting: 'Hi, Halliday! Where would you like to start?',
        inputPlaceholder: 'Ask Nimi…',
        inputNote: 'Preview only; real conversations happen in the Nimi desktop app.',
        sendLabel: 'Send',
        backLabel: 'Back',
        userName: 'Halliday',
        defaultTargetId: 'agent-a',
        scriptedReply: 'This is a sample reply to preview the conversation style; real answers are generated in the Nimi desktop app.',
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
            name: 'Sample character A',
            initial: 'A',
            messages: [
              { id: 'a-m1', role: 'user', text: 'Turn this week’s meeting notes into key points.', minutesAgo: 8 },
              { id: 'a-m2', role: 'assistant', text: 'Done: five key points, two of them need your confirmation.', minutesAgo: 7 },
              { id: 'a-m3', role: 'user', text: 'Show me the ones that need confirmation first.', minutesAgo: 6 },
              { id: 'a-m4', role: 'assistant', text: 'The first is the budget basis; the second is the release date. Once confirmed, I will sync them to the notes.', minutesAgo: 5 },
            ],
          },
          {
            id: 'agent-e',
            name: 'Sample character E',
            initial: 'E',
            messages: [
              { id: 'e-m1', role: 'assistant', text: 'Welcome back. Shall we pick up the character setup from last time?', minutesAgo: 1560 },
              { id: 'e-m2', role: 'user', text: 'Yes — tighten the protagonist’s motivation one more layer.', minutesAgo: 1558 },
            ],
          },
          {
            id: 'agent-k',
            name: 'Sample character K',
            initial: 'K',
            messages: [
              { id: 'k-m1', role: 'assistant', text: 'This week’s exploration notes are organized and ready to review.', minutesAgo: 3000 },
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
              { name: 'Sample character A', meta: 'Character · sample data' },
              { name: 'Sample character E', meta: 'Character · sample data' },
            ],
          },
          { label: 'Worlds', items: [{ name: 'Sample world', meta: 'World · sample data' }] },
          {
            label: 'Apps',
            items: [
              { name: 'ParentOS', meta: 'Keep a child’s growth journal' },
              { name: 'Storybook', meta: 'Read and create interactive stories' },
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
        tabPlaceholderNote: 'This panel is not included in the sample data.',
        aboutTitle: 'About',
        updatedLabel: 'Last updated',
        moreInfoLabel: 'More info',
        previewBadge: 'Interactive preview · sample data',
        previewUnavailableTitle: 'Preview not connected',
        previewUnavailableBody: 'This App has no interactive preview yet. Choose another App from the library.',
        closeLabel: 'Close',
        items: [
          { id: 'nimi.zhiyu', name: 'Zhiyu', task: 'Incubate local AI companions: chat, companionship, and growing together.', tags: ['Text', 'Speech'], updatedAt: 'September 17, 2026', localDev: true },
          { id: 'nimi.parentos', name: 'ParentOS', task: `Keep a child's growth journal and family observations.`, tags: ['Text', 'Transcription'], updatedAt: 'September 15, 2026', localDev: true, iconSrc: '/demo/parentos-icon.png' },
          { id: "io.github.nimiplatform.jev-search", name: "Jev Search", task: "Search in plain language, choose sources, and explore ranked links.", tags: ["Search","Ranking"], updatedAt: "October 12, 2026", localDev: true, iconSrc: '/demo/jev-search-icon.png' },
          { id: "io.github.nimiplatform.jev-ultrafast", name: "Jev Ultrafast", task: "Give the browser a goal; observe, choose, and act one step at a time.", tags: ["Browser tasks","Text"], updatedAt: "October 12, 2026", localDev: true, iconSrc: '/demo/jev-ultrafast-icon.png' },
          { id: "moneyprinterturbo.studio", name: "MoneyPrinterTurbo", task: "Build a short video from a script, footage, narration, and subtitles.", tags: ["Text","Speech","Video"], updatedAt: "October 12, 2026", localDev: true, iconSrc: '/demo/moneyprinter-icon.png' },
          { id: "ai.nimi.openwhispr", name: "OpenWhispr", task: "Turn spoken ideas into dictation, notes, and searchable recordings.", tags: ["Dictation","Notes","Search"], updatedAt: "October 12, 2026", localDev: true, iconSrc: '/demo/openwhispr-icon.png' },
          { id: "ai.nimi.videolingo", name: "VideoLingo", task: "Transcribe video, review bilingual subtitles, translate, and dub.", tags: ["Transcription","Translation","Speech"], updatedAt: "October 12, 2026", localDev: true, iconSrc: '/demo/videolingo-icon.png' },
          { id: "nimiplatform.voicestudio", name: "VoiceStudio", task: "Design voices and create narration, stories, and audiobooks.", tags: ["Voice design","Speech","Transcription"], updatedAt: "October 12, 2026", localDev: true, iconSrc: '/demo/voicestudio-icon.png' },
          {"id":"nimi.overtone","name":"Nimi Overtone","task":"Explore musical directions, shape lyrics, and compare audio takes.","tags":["Music","Lyrics"],"updatedAt":"2026-10-13","localDev":true,"iconSrc":"/demo/overtone-icon.png"},
          { id: 'nimi.storybook', name: 'Storybook', task: 'Read and create interactive stories.', tags: ['Text'], updatedAt: 'September 10, 2026', localDev: false, iconSrc: '/demo/storybook-icon.png' },
          {"id":"nimi.realm-persona-studio","name":"Realm Persona Studio","task":"Create Realm Personas and maintain their profiles, visual identity, and drafts.","tags":["Characters","Images"],"updatedAt":"2026-10-13","localDev":true,"iconSrc":"/demo/persona-studio-icon.png"},
          { id: 'nimi.shijing', name: 'ShiJing', task: 'Personal rhythm readings.', tags: ['Text'], updatedAt: 'September 5, 2026', localDev: true },
          { id: 'nimi.odd-bureau', name: 'Odd Bureau', task: 'Turn a photo into a playable world of everyday objects.', tags: ['Image', 'Text', 'Speech'], updatedAt: 'September 18, 2026', localDev: true },
          {"id":"nimi.inscape","name":"Inscape","task":"Local personality exploration and everyday reflection for adults.","tags":["Self-exploration","Reflection"],"updatedAt":"2026-10-13","localDev":true,"iconSrc":"/demo/inscape-icon.png"},
          {"id":"nimi.polyagent","name":"PolyAgent","task":"Inspect prediction markets, strategy constraints, research, and paper ledgers.","tags":["Market research","Paper trading"],"updatedAt":"2026-10-13","localDev":true,"iconSrc":"/demo/polyagent-icon.png"},
          {"id":"nimi.realm-world-studio","name":"Realm World Studio","task":"Develop world concepts, settings, and characters in your Realm worlds.","tags":["World building","Characters"],"updatedAt":"2026-10-13","localDev":true,"iconSrc":"/demo/world-studio-icon.png"},
          {"id":"org.nimiplatform.deeptutor","name":"DeepTutor","task":"Study documents, understand concepts, practice, and keep learning notes.","tags":["Learning","Research","Notes"],"updatedAt":"2026-10-13","localDev":true,"iconSrc":"/demo/deeptutor-icon.png"},
          {"id":"openmontage.studio","name":"OpenMontage","task":"Plan narrated videos through briefs, scripts, storyboards, and review.","tags":["Storyboards","Video","Speech"],"updatedAt":"2026-10-13","localDev":true,"iconSrc":"/demo/openmontage-icon.png"},
          {"id":"org.nimiplatform.sillytavern","name":"SillyTavern","task":"Chat with fictional characters and organize personas and world information.","tags":["Character chat","World information"],"updatedAt":"2026-10-13","localDev":true,"iconSrc":"/demo/sillytavern-icon.png"},
          {"id":"nimiplatform.vane","name":"Vane","task":"Research a question, explore its sources, and organize what you find.","tags":["Search","Research"],"updatedAt":"2026-10-13","localDev":true,"iconSrc":"/demo/vane-icon.png"},
          {"id":"io.github.nimiplatform.next-ai-draw-io","name":"Next AI Draw.io","task":"Describe diagrams in natural language, edit the canvas, and manage revisions.","tags":["Diagrams","Text"],"updatedAt":"2026-10-13","localDev":true,"iconSrc":"/demo/drawio-icon.png"},
          {"id":"io.github.nimiplatform.open-notebook","name":"Open Notebook","task":"Connect sources, questions, and notes in one research and podcast workspace.","tags":["Research","Notes","Podcasts"],"updatedAt":"2026-10-13","localDev":true,"iconSrc":"/demo/open-notebook-icon.png"},
          {"id":"io.github.nimiplatform.presenton","name":"Presenton","task":"Create presentations, edit slides, select templates, and present your work.","tags":["Presentations","Editing"],"updatedAt":"2026-10-13","localDev":true,"iconSrc":"/demo/presenton-icon.png"},
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
        subtitle: 'Local runtime and AI supply status · sample data',
        groups: [
          { label: 'Service', rows: [{ label: 'Runtime status', value: 'Running' }, { label: 'Version', value: 'Preview build' }] },
          { label: 'Model supply', rows: [{ label: 'Local models', value: '1 ready' }, { label: 'Cloud connections', value: '2' }] },
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
    title: 'From work to interests, explore different AI apps.',
    subtitle: 'Use free Nimi apps for everyday work, and for the interests and needs in your life.',
  },
  worlds: {
    title: 'Meet AI characters and step into their worlds.',
    subtitle: 'Find characters that interest you, talk with them, and explore different worlds.',
    body: 'Start with a conversation, get to know a character, and learn about the world they belong to. Come with a question, or just to meet a new conversation partner.',
    exampleTitle: 'A typical start',
    exampleSteps: [
      'Pick a character that interests you in Nimi.',
      'Start with one conversation and get to know the character and their world.',
      'Keep the conversation going, or go back to the world to see who else is there.',
    ],
    cta: 'Explore characters & worlds',
  },
  capabilities: {
    title: 'Local or cloud — choose what fits.',
    subtitle: 'Pick the AI runtime that matches your task, your device, and your costs.',
    tasks: [
      {
        id: 'writing',
        title: 'Writing & organizing',
        description: 'Draft, rewrite, summarize, and turn scattered material into something usable.',
      },
      {
        id: 'image',
        title: 'Image creation',
        description: 'Generate and adjust images for your projects and notes.',
      },
      {
        id: 'media',
        title: 'Video & audio',
        description: 'Work with video, transcribe speech, and separate or organize audio tracks.',
      },
      {
        id: 'music',
        title: 'Music',
        description: 'Generate music, and keep lyrics and versions organized.',
      },
      {
        id: 'conversation',
        title: 'Conversation & realtime',
        description: 'Talk in text or voice, and pick up a live conversation where you left it.',
      },
      {
        id: 'vision',
        title: 'Vision & locating',
        description: 'Recognize objects and positions in an image for apps that need to see.',
      },
    ],
    localTitle: 'Local AI',
    localText: 'Models run on your computer and incur no cloud model-call fees. What you can run depends on your device and the model requirements.',
    cloudTitle: 'Cloud AI',
    cloudText: 'Connect supported cloud capabilities. Terms and fees are set by the corresponding provider.',
    costNote: 'Nimi itself is free. Cloud calls may cost money, and whether a third-party app charges is up to its publisher.',
    cta: 'Understand model support and requirements',
  },
  create: {
    title: 'Turn your idea into your own app.',
    subtitle: 'Build a local AI tool around your tasks and habits.',
    body: 'Start from one concrete need: what it handles, the steps it follows, and the result it returns. Connect the AI capabilities it needs so the app works your way.',
    steps: [
      {
        title: 'Describe the need',
        description: 'Write down what it handles, the steps it follows, and the result you want.',
      },
      {
        title: 'Create the project',
        description: 'Scaffold a local project with Nimi App tools. Node and a local development environment are required.',
      },
      {
        title: 'Connect capabilities',
        description: 'Use the Nimi SDK to connect the AI capabilities and organize your workflow.',
      },
      {
        title: 'Run it locally',
        description: 'Run and iterate locally until it fits your habits.',
      },
    ],
    caveat: 'Creating a personal app currently requires developer tools and local development mode; it is not a no-code flow.',
    cta: 'Learn how to create a personal app',
  },
  continuity: {
    title: 'A different app, the same AI that knows you.',
    subtitle: 'Authorized apps can continue with the same local AI and conversation. Its long-term memories stay private to that AI on this device.',
    body: 'When memory is enabled and relevant memories are available, they can inform the next interaction. Switching apps does not automatically share memory with another AI or device.',
    supports: ['Apps access your AI with your authorization.', 'Different AIs keep separate memories.'],
  },
  developers: {
    eyebrow: 'For developers',
    title: 'Bring your app to Nimi.',
    subtitle: 'Use supported local and cloud AI capabilities through the Nimi SDK — build something new, or adapt an existing project.',
    body: 'Start with the integration path, capability support, and examples to learn how Nimi Apps are developed and run.',
    points: [
      'Nimi SDK: one interface to local and cloud AI capabilities.',
      'Guides: from creating a project to its first AI call, with the requirements for each step.',
      'Scaffold: create a local app project with app-tools and iterate at your own pace.',
    ],
    primaryCta: 'Read the developer guide',
    secondaryCta: 'View source',
  },
  getStarted: {
    title: 'Explore AI your way.',
    subtitle: 'Check the download status, find the apps you need, or meet an AI character that interests you. Choose your AI and start with what you want to do.',
    primaryCta: 'Check download status',
    availability: 'Nimi is not available to install yet, and using it requires a Nimi account. The download page has the current status for each platform.',
    secondaryCta: 'Explore apps',
  },
  footer: {
    line1: 'MAKE AI TRULY YOURS',
    line2: 'Use free apps, meet AI characters, explore different worlds.',
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
