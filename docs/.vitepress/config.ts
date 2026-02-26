import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'Nimi',
  description: 'AI-Native Open World Platform — Developer Documentation',

  cleanUrls: true,
  lastUpdated: true,

  // Ignore links that point outside docs/ (project source files, AGENTS.md, etc.)
  ignoreDeadLinks: true,

  // Map README.md to index.md so directory URLs resolve correctly.
  rewrites: {
    'getting-started/README.md': 'getting-started/index.md',
    'architecture/README.md': 'architecture/index.md',
    'sdk/README.md': 'sdk/index.md',
    'runtime/README.md': 'runtime/index.md',
    'protocol/README.md': 'protocol/index.md',
    'mods/README.md': 'mods/index.md',
    'examples/README.md': 'examples/index.md',
  },

  themeConfig: {
    nav: [
      { text: 'Guide', link: '/getting-started/' },
      { text: 'SSOT', link: '/architecture/ssot' },
      { text: 'SDK', link: '/sdk/' },
      { text: 'Runtime', link: '/runtime/' },
      { text: 'Examples', link: '/examples/' },
      {
        text: 'More',
        items: [
          { text: 'Protocol', link: '/protocol/' },
          { text: 'Error Codes', link: '/error-codes' },
          { text: 'Mod Development', link: '/mods/' },
          { text: 'FAQ', link: '/faq' },
        ],
      },
    ],

    sidebar: {
      '/': [
        {
          text: 'Getting Started',
          items: [
            { text: 'Quick Start', link: '/getting-started/' },
            { text: 'Code Examples', link: '/examples/' },
          ],
        },
        {
          text: 'Architecture',
          items: [
            { text: 'Overview', link: '/architecture/' },
            { text: 'SSOT', link: '/architecture/ssot' },
            { text: 'Protocol', link: '/protocol/' },
          ],
        },
        {
          text: 'SDK',
          items: [
            { text: 'SDK Reference', link: '/sdk/' },
            { text: 'Error Codes', link: '/error-codes' },
          ],
        },
        {
          text: 'Runtime',
          items: [
            { text: 'CLI & Configuration', link: '/runtime/' },
            { text: 'AI Provider Matrix', link: '/runtime/ai-provider-support-matrix' },
          ],
        },
        {
          text: 'Mods',
          items: [
            { text: 'Mod Development', link: '/mods/' },
          ],
        },
        {
          text: 'Reference',
          items: [
            { text: 'FAQ', link: '/faq' },
          ],
        },
        {
          text: 'Contributing',
          collapsed: true,
          items: [
            { text: 'Development Setup', link: '/dev/setup' },
            { text: 'Architecture Internals', link: '/dev/architecture-internals' },
            { text: 'Testing', link: '/dev/testing' },
            { text: 'Release Process', link: '/dev/release' },
          ],
        },
      ],
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/nimiplatform/nimi' },
    ],

    editLink: {
      pattern: 'https://github.com/nimiplatform/nimi/edit/main/docs/:path',
      text: 'Edit this page on GitHub',
    },

    search: {
      provider: 'local',
    },

    footer: {
      message: 'Released under Apache-2.0 (runtime, sdk, proto) / MIT (desktop, nimi-mods, web) / CC-BY-4.0 (docs)',
      copyright: 'Copyright © 2024-present Nimi Platform',
    },
  },
})
