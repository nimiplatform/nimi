import type { LandingLocale } from '../i18n/locale.js';

export type LandingContent = {
  localeName: string;
  skipToContent: string;
  nav: {
    install: string;
    sdk: string;
    desktop: string;
    mods: string;
  };
  hero: {
    eyebrow: string;
    title: string;
    titleAccent: string;
    subtitle: string;
    description: string;
    primaryCta: string;
    docsCta: string;
    altInstallLabel: string;
    altInstallCommand: string;
    installCommand: string;
    copyCommandLabel: string;
    copiedCommandLabel: string;
    githubCta: string;
  };
  install: {
    title: string;
    subtitle: string;
    terminalLabel: string;
    terminalSteps: Array<{ comment: string; command: string }>;
    previewLabel: string;
    previewAlt: string;
    previewCaption: string;
    sdkLabel: string;
    sdkSnippet: string;
    docsCtaLabel: string;
  };
  sdk: {
    title: string;
    subtitle: string;
    tabs: Array<{
      label: string;
      snippet: string;
      caption: string;
    }>;
    previewLabel: string;
    previewAlt: string;
    previewCaption: string;
    multimodalLabel: string;
    multimodalAlt: string;
    multimodalCaption: string;
    callout: string;
  };
  desktop: {
    title: string;
    subtitle: string;
    screenshotAlt: string;
    features: Array<{
      icon: string;
      title: string;
      description: string;
    }>;
    downloadCta: string;
  };
  mods: {
    title: string;
    subtitle: string;
    items: Array<{
      icon: string;
      name: string;
      description: string;
    }>;
    buildModCta: string;
  };
  openSource: {
    title: string;
    subtitle: string;
    description: string;
    githubCta: string;
    docsCta: string;
  };
  finalCta: {
    title: string;
    description: string;
    primaryCta: string;
    githubCta: string;
  };
  footer: { line1: string; line2: string };
  localeToggleLabel: string;
  localeOptions: { en: string; zh: string };
};

const EN_SDK_SNIPPET = `import { Runtime } from '@nimiplatform/sdk';

const runtime = new Runtime();

const response = await runtime.generate({
  prompt: 'Explain Nimi in one sentence.',
});

console.log(response.text);`;

const ZH_SDK_SNIPPET = `import { Runtime } from '@nimiplatform/sdk';

const runtime = new Runtime();

const response = await runtime.generate({
  prompt: '用一句话解释 Nimi。',
});

console.log(response.text);`;

const EN_TAB_LOCAL = `import { Runtime } from '@nimiplatform/sdk';

const runtime = new Runtime();

const result = await runtime.generate({
  prompt: 'Explain quantum computing simply.',
});

console.log(result.text);`;

const EN_TAB_CLOUD = `import { Runtime } from '@nimiplatform/sdk';

const runtime = new Runtime();

const result = await runtime.generate({
  provider: 'gemini',
  prompt: 'Write a haiku about open source.',
});

console.log(result.text);`;

const EN_TAB_STREAMING = `import { Runtime } from '@nimiplatform/sdk';

const runtime = new Runtime();

const stream = await runtime.stream({
  prompt: 'Tell me a story about a robot.',
});

for await (const chunk of stream) {
  process.stdout.write(chunk.text);
}`;

const ZH_TAB_LOCAL = `import { Runtime } from '@nimiplatform/sdk';

const runtime = new Runtime();

const result = await runtime.generate({
  prompt: '用简单的话解释量子计算。',
});

console.log(result.text);`;

const ZH_TAB_CLOUD = `import { Runtime } from '@nimiplatform/sdk';

const runtime = new Runtime();

const result = await runtime.generate({
  provider: 'gemini',
  prompt: '写一首关于开源的俳句。',
});

console.log(result.text);`;

const ZH_TAB_STREAMING = `import { Runtime } from '@nimiplatform/sdk';

const runtime = new Runtime();

const stream = await runtime.stream({
  prompt: '给我讲一个关于机器人的故事。',
});

for await (const chunk of stream) {
  process.stdout.write(chunk.text);
}`;

export const LANDING_CONTENT: Record<LandingLocale, LandingContent> = {
  en: {
    localeName: 'English',
    skipToContent: 'Skip to main content',
    nav: {
      install: 'Install',
      sdk: 'SDK',
      desktop: 'Desktop',
      mods: 'Mods',
    },
    hero: {
      eyebrow: 'Install in seconds',
      title: 'Install once. Run',
      titleAccent: 'local + cloud AI.',
      subtitle: 'One runtime, one CLI, and one SDK for the full first-run path.',
      description: 'Start with the install script, download the desktop app, or jump straight into the docs.',
      primaryCta: 'Download Desktop',
      docsCta: 'Read the documentation',
      altInstallLabel: 'Or use',
      altInstallCommand: 'npm install -g @nimiplatform/nimi',
      installCommand: 'curl -fsSL https://install.nimi.xyz | sh',
      copyCommandLabel: 'Copy',
      copiedCommandLabel: 'Copied',
      githubCta: 'View on GitHub',
    },
    install: {
      title: 'Up and running in seconds',
      subtitle: 'One command to install. One command to start. One SDK to integrate.',
      terminalLabel: 'Terminal',
      terminalSteps: [
        { comment: 'Install Nimi', command: 'curl -fsSL https://install.nimi.xyz | sh' },
        { comment: 'Start the runtime', command: 'nimi start' },
        { comment: 'Run a model', command: 'nimi run "What is Nimi?"' },
      ],
      previewLabel: 'Quickstart walkthrough',
      previewAlt: 'Nimi quickstart walkthrough',
      previewCaption: 'Install, start the runtime, and get a first answer from the CLI in one flow.',
      sdkLabel: 'SDK',
      sdkSnippet: EN_SDK_SNIPPET,
      docsCtaLabel: 'Read the docs',
    },
    sdk: {
      title: 'One SDK for every AI model',
      subtitle: 'Local models, cloud providers, streaming — same import, same API.',
      tabs: [
        {
          label: 'Local Model',
          snippet: EN_TAB_LOCAL,
          caption: 'Run models on your machine. No API keys needed.',
        },
        {
          label: 'Cloud Model',
          snippet: EN_TAB_CLOUD,
          caption: 'Same API, add a provider to move from local to cloud.',
        },
        {
          label: 'Streaming',
          snippet: EN_TAB_STREAMING,
          caption: 'Stream responses token by token. Same interface, local or cloud.',
        },
      ],
      previewLabel: 'SDK walkthrough',
      previewAlt: 'Nimi SDK walkthrough',
      previewCaption: 'Go from `new Runtime()` to local and cloud generation without changing the app surface.',
      multimodalLabel: 'Beyond text',
      multimodalAlt: 'Nimi multimodal walkthrough',
      multimodalCaption: 'The same runtime also handles image and speech flows when you move past text-only examples.',
      callout: 'Same import. Same API. Local or cloud.',
    },
    desktop: {
      title: 'Desktop app for AI',
      subtitle: 'Manage models, chat with AI, and run mods — all from your desktop.',
      screenshotAlt: 'Nimi Desktop App Preview',
      features: [
        { icon: '\u{1F5A5}', title: 'Runtime Dashboard', description: 'Monitor running models, health status, and resource usage.' },
        { icon: '\u{1F4AC}', title: 'Built-in Chat', description: 'Chat with any local or cloud model directly.' },
        { icon: '\u{1F9E9}', title: 'Mod Host', description: 'Install and run mods inside the desktop app.' },
        { icon: '\u{1F4E6}', title: 'Model Management', description: 'Download, update, and switch between local models.' },
      ],
      downloadCta: 'Download Desktop App',
    },
    mods: {
      title: 'Extend with mods',
      subtitle: 'Pre-built apps powered by the Nimi runtime. Or build your own.',
      items: [
        { icon: '\u{1F4AC}', name: 'local-chat', description: 'Chat with local AI models. Private, fast, no network.' },
        { icon: '\u{1F4CA}', name: 'kismet', description: 'Economic simulation engine with real-time charts.' },
        { icon: '\u{1F3A7}', name: 'audio-book', description: 'Multi-voice audiobooks with AI narration.' },
        { icon: '\u{1F3AC}', name: 'videoplay', description: 'Episode-scale video from narrative scripts.' },
        { icon: '\u{1F3AE}', name: 'textplay', description: 'Interactive fiction with branching narratives.' },
        { icon: '\u{1F4DA}', name: 'knowledge-base', description: 'Document indexing and AI-powered search.' },
      ],
      buildModCta: 'Build your own mod',
    },
    openSource: {
      title: 'Open source at the core',
      subtitle: 'Built in the open. Ship with confidence.',
      description: "Nimi's runtime, SDK, and desktop app are open source under Apache-2.0 and MIT. Realm is an optional managed cloud layer — its contracts are public through the SDK.",
      githubCta: 'View on GitHub',
      docsCta: 'Read the docs',
    },
    finalCta: {
      title: 'Start building with Nimi',
      description: 'One runtime, one SDK, one desktop app. Local and cloud AI, unified.',
      primaryCta: 'Get Started',
      githubCta: 'View on GitHub',
    },
    footer: {
      line1: 'Nimi: Open-Source AI Runtime',
      line2: 'Licenses: Apache-2.0 (runtime/sdk), MIT (apps), CC-BY-4.0 (docs)',
    },
    localeToggleLabel: 'Language',
    localeOptions: {
      en: 'EN',
      zh: '\u4E2D',
    },
  },
  zh: {
    localeName: '\u7B80\u4F53\u4E2D\u6587',
    skipToContent: '\u8DF3\u8F6C\u5230\u4E3B\u8981\u5185\u5BB9',
    nav: {
      install: '\u5B89\u88C5',
      sdk: 'SDK',
      desktop: '\u684C\u9762\u7AEF',
      mods: '\u6A21\u7EC4',
    },
    hero: {
      eyebrow: '\u51E0\u79D2\u5B8C\u6210\u5B89\u88C5',
      title: '\u4E00\u6B21\u5B89\u88C5\uFF0C\u8DD1\u901A',
      titleAccent: '\u672C\u5730\u4E0E\u4E91\u7AEF AI\u3002',
      subtitle: '\u4E00\u4E2A runtime\u3001\u4E00\u4E2A CLI\u3001\u4E00\u5957 SDK\uff0C\u62FF\u4E0B\u5B8C\u6574\u7684 first-run \u8DEF\u5F84\u3002',
      description: '\u5148\u7528\u5B89\u88C5\u811A\u672C\u8D77\u6B65\uff0C\u6216\u76F4\u63A5\u4E0B\u8F7D desktop\uff0C\u4E5F\u53EF\u4EE5\u7ACB\u5373\u8DF3\u5230\u6587\u6863\u3002',
      primaryCta: '\u4E0B\u8F7D Desktop',
      docsCta: '\u9605\u8BFB\u6587\u6863',
      altInstallLabel: '\u6216\u8005\u76F4\u63A5\u7528',
      altInstallCommand: 'npm install -g @nimiplatform/nimi',
      installCommand: 'curl -fsSL https://install.nimi.xyz | sh',
      copyCommandLabel: '\u590D\u5236',
      copiedCommandLabel: '\u5DF2\u590D\u5236',
      githubCta: '\u67E5\u770B GitHub',
    },
    install: {
      title: '\u51E0\u79D2\u5373\u53EF\u8FD0\u884C',
      subtitle: '\u4E00\u6761\u547D\u4EE4\u5B89\u88C5\uFF0C\u4E00\u6761\u547D\u4EE4\u540E\u53F0\u542F\u52A8\uFF0C\u4E00\u5957 SDK \u96C6\u6210\u3002',
      terminalLabel: '\u7EC8\u7AEF',
      terminalSteps: [
        { comment: '\u5B89\u88C5 Nimi', command: 'curl -fsSL https://install.nimi.xyz | sh' },
        { comment: '\u542F\u52A8\u8FD0\u884C\u65F6', command: 'nimi start' },
        { comment: '\u8FD0\u884C\u6A21\u578B', command: 'nimi run "Nimi \u662F\u4EC0\u4E48\uFF1F"' },
      ],
      previewLabel: '\u5FEB\u901F\u4E0A\u624B\u6F14\u793A',
      previewAlt: 'Nimi \u5FEB\u901F\u4E0A\u624B\u6F14\u793A',
      previewCaption: '\u4ECE\u5B89\u88C5\u3001\u542F\u52A8 runtime \u5230\u5728 CLI \u4E2D\u8DD1\u901A\u7B2C\u4E00\u6761\u56DE\u7B54\uFF0C\u4E00\u6B21\u770B\u5B8C\u3002',
      sdkLabel: 'SDK',
      sdkSnippet: ZH_SDK_SNIPPET,
      docsCtaLabel: '\u67E5\u770B\u6587\u6863',
    },
    sdk: {
      title: '\u4E00\u5957 SDK \u8986\u76D6\u6240\u6709 AI \u6A21\u578B',
      subtitle: '\u672C\u5730\u6A21\u578B\u3001\u4E91\u670D\u52A1\u3001\u6D41\u5F0F\u8F93\u51FA\u2014\u2014\u540C\u4E00\u4E2A import\uFF0C\u540C\u4E00\u5957 API\u3002',
      tabs: [
        {
          label: '\u672C\u5730\u6A21\u578B',
          snippet: ZH_TAB_LOCAL,
          caption: '\u5728\u672C\u5730\u8FD0\u884C\u6A21\u578B\uFF0C\u65E0\u9700 API Key\u3002',
        },
        {
          label: '\u4E91\u7AEF\u6A21\u578B',
          snippet: ZH_TAB_CLOUD,
          caption: '\u540C\u4E00\u5957 API\uFF0C\u53EA\u9700\u52A0\u4E0A provider \u5C31\u80FD\u5207\u5230\u4E91\u7AEF\u3002',
        },
        {
          label: '\u6D41\u5F0F\u8F93\u51FA',
          snippet: ZH_TAB_STREAMING,
          caption: '\u9010 token \u6D41\u5F0F\u54CD\u5E94\uFF0C\u672C\u5730\u6216\u4E91\u7AEF\u7EDF\u4E00\u63A5\u53E3\u3002',
        },
      ],
      previewLabel: 'SDK \u6F14\u793A',
      previewAlt: 'Nimi SDK \u6F14\u793A',
      previewCaption: '\u4ECE `new Runtime()` \u5230\u672C\u5730\u4E0E\u4E91\u7AEF\u751F\u6210\uFF0C\u5E94\u7528\u4FA7\u63A5\u53E3\u4FDD\u6301\u4E0D\u53D8\u3002',
      multimodalLabel: '\u4E0D\u53EA\u662F\u6587\u672C',
      multimodalAlt: 'Nimi \u591A\u6A21\u6001\u6F14\u793A',
      multimodalCaption: '\u8D85\u8FC7\u6587\u672C\u793A\u4F8B\u4E4B\u540E\uFF0C\u540C\u4E00\u4E2A runtime \u4E5F\u80FD\u5904\u7406\u56FE\u50CF\u4E0E\u8BED\u97F3\u6D41\u7A0B\u3002',
      callout: '\u540C\u4E00\u4E2A import\u3002\u540C\u4E00\u5957 API\u3002\u672C\u5730\u6216\u4E91\u7AEF\u3002',
    },
    desktop: {
      title: 'AI \u684C\u9762\u5E94\u7528',
      subtitle: '\u7BA1\u7406\u6A21\u578B\u3001\u4E0E AI \u5BF9\u8BDD\u3001\u8FD0\u884C\u6A21\u7EC4\u2014\u2014\u5168\u90E8\u5728\u684C\u9762\u7AEF\u5B8C\u6210\u3002',
      screenshotAlt: 'Nimi \u684C\u9762\u5E94\u7528\u9884\u89C8',
      features: [
        { icon: '\u{1F5A5}', title: '\u8FD0\u884C\u65F6\u4EEA\u8868\u76D8', description: '\u76D1\u63A7\u8FD0\u884C\u4E2D\u7684\u6A21\u578B\u3001\u5065\u5EB7\u72B6\u6001\u548C\u8D44\u6E90\u4F7F\u7528\u3002' },
        { icon: '\u{1F4AC}', title: '\u5185\u7F6E\u5BF9\u8BDD', description: '\u76F4\u63A5\u4E0E\u4EFB\u4F55\u672C\u5730\u6216\u4E91\u7AEF\u6A21\u578B\u5BF9\u8BDD\u3002' },
        { icon: '\u{1F9E9}', title: '\u6A21\u7EC4\u5BBF\u4E3B', description: '\u5728\u684C\u9762\u5E94\u7528\u5185\u5B89\u88C5\u548C\u8FD0\u884C\u6A21\u7EC4\u3002' },
        { icon: '\u{1F4E6}', title: '\u6A21\u578B\u7BA1\u7406', description: '\u4E0B\u8F7D\u3001\u66F4\u65B0\u548C\u5207\u6362\u672C\u5730\u6A21\u578B\u3002' },
      ],
      downloadCta: '\u4E0B\u8F7D\u684C\u9762\u5E94\u7528',
    },
    mods: {
      title: '\u7528\u6A21\u7EC4\u6269\u5C55',
      subtitle: '\u57FA\u4E8E Nimi \u8FD0\u884C\u65F6\u7684\u9884\u5236\u5E94\u7528\uFF0C\u6216\u81EA\u5DF1\u6784\u5EFA\u3002',
      items: [
        { icon: '\u{1F4AC}', name: 'local-chat', description: '\u4E0E\u672C\u5730 AI \u6A21\u578B\u5BF9\u8BDD\u3002\u79C1\u5BC6\u3001\u5FEB\u901F\u3001\u65E0\u9700\u7F51\u7EDC\u3002' },
        { icon: '\u{1F4CA}', name: 'kismet', description: '\u5B9E\u65F6\u56FE\u8868\u7ECF\u6D4E\u6A21\u62DF\u5F15\u64CE\u3002' },
        { icon: '\u{1F3A7}', name: 'audio-book', description: 'AI \u591A\u89D2\u8272\u6717\u8BFB\u6709\u58F0\u4E66\u3002' },
        { icon: '\u{1F3AC}', name: 'videoplay', description: '\u4ECE\u53D9\u4E8B\u811A\u672C\u751F\u6210\u5267\u96C6\u7EA7\u89C6\u9891\u3002' },
        { icon: '\u{1F3AE}', name: 'textplay', description: '\u5206\u652F\u53D9\u4E8B\u4EA4\u4E92\u5F0F\u5C0F\u8BF4\u3002' },
        { icon: '\u{1F4DA}', name: 'knowledge-base', description: '\u6587\u6863\u7D22\u5F15\u4E0E AI \u667A\u80FD\u641C\u7D22\u3002' },
      ],
      buildModCta: '\u6784\u5EFA\u4F60\u7684\u6A21\u7EC4',
    },
    openSource: {
      title: '\u5F00\u6E90\u4E3A\u5148',
      subtitle: '\u5728\u5F00\u653E\u4E2D\u6784\u5EFA\uFF0C\u653E\u5FC3\u4EA4\u4ED8\u3002',
      description: 'Nimi \u7684\u8FD0\u884C\u65F6\u3001SDK \u548C\u684C\u9762\u5E94\u7528\u5747\u4EE5 Apache-2.0 \u548C MIT \u5F00\u6E90\u3002Realm \u662F\u53EF\u9009\u7684\u6258\u7BA1\u4E91\u5C42\u2014\u2014\u5176\u5408\u7EA6\u901A\u8FC7 SDK \u516C\u5F00\u3002',
      githubCta: '\u67E5\u770B GitHub',
      docsCta: '\u67E5\u770B\u6587\u6863',
    },
    finalCta: {
      title: '\u5F00\u59CB\u4F7F\u7528 Nimi \u6784\u5EFA',
      description: '\u4E00\u4E2A\u8FD0\u884C\u65F6\uFF0C\u4E00\u5957 SDK\uFF0C\u4E00\u4E2A\u684C\u9762\u5E94\u7528\u3002\u672C\u5730\u4E0E\u4E91\u7AEF AI\uFF0C\u7EDF\u4E00\u4F53\u9A8C\u3002',
      primaryCta: '\u5F00\u59CB\u4F7F\u7528',
      githubCta: '\u67E5\u770B GitHub',
    },
    footer: {
      line1: 'Nimi: \u5F00\u6E90 AI \u8FD0\u884C\u65F6',
      line2: '\u8BB8\u53EF\u8BC1\uFF1AApache-2.0\uFF08runtime/sdk\uFF09\u3001MIT\uFF08apps\uFF09\u3001CC-BY-4.0\uFF08docs\uFF09',
    },
    localeToggleLabel: '\u8BED\u8A00',
    localeOptions: {
      en: 'EN',
      zh: '\u4E2D',
    },
  },
};

export function getLandingContent(locale: LandingLocale): LandingContent {
  return LANDING_CONTENT[locale];
}
