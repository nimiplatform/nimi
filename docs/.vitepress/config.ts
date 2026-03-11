import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'Nimi Developer Portal',
  description: 'Developer documentation for building with Nimi runtime, realm, and SDK.',

  cleanUrls: true,
  lastUpdated: true,
  ignoreDeadLinks: true,

  rewrites: {
    'getting-started/README.md': 'getting-started/index.md',
    'architecture/README.md': 'architecture/index.md',
    'architecture/ssot.md': 'architecture/spec-map.md',
    'sdk/README.md': 'reference/sdk.md',
    'protocol/README.md': 'reference/protocol.md',
    'mods/README.md': 'guides/mod-developer.md',
    'error-codes.md': 'reference/error-codes.md',
    'faq.md': 'reference/faq.md',
    'examples/README.md': 'cookbook/quick-recipes.md',
  },

  themeConfig: {
    nav: [
      { text: 'Getting Started', link: '/getting-started/' },
      {
        text: 'Guides',
        items: [
          { text: 'App Developer', link: '/guides/app-developer' },
          { text: 'Mod Developer', link: '/guides/mod-developer' },
          { text: 'Mod Release', link: '/guides/mod-release' },
          { text: 'Mod Release (CN)', link: '/guides/mod-release_cn' },
          { text: 'Runtime Integrator', link: '/guides/runtime-integrator' },
        ],
      },
      { text: 'Cookbook', link: '/cookbook/quick-recipes' },
      {
        text: 'Reference',
        items: [
          { text: 'SDK', link: '/reference/sdk' },
          { text: 'Runtime', link: '/reference/runtime' },
          { text: 'Protocol', link: '/reference/protocol' },
          { text: 'Error Codes', link: '/reference/error-codes' },
          { text: 'Provider Matrix', link: '/reference/provider-matrix' },
          { text: 'Compatibility Matrix', link: '/reference/compatibility-matrix' },
          { text: 'FAQ', link: '/reference/faq' },
        ],
      },
      { text: 'Architecture', link: '/architecture/' },
      { text: 'Contribute', link: '/contribute/' },
    ],

    sidebar: {
      '/': [
        {
          text: 'Start',
          items: [
            { text: 'Portal Overview', link: '/' },
            { text: 'Getting Started', link: '/getting-started/' },
          ],
        },
        {
          text: 'Guides',
          items: [
            { text: 'App Developer', link: '/guides/app-developer' },
            { text: 'Mod Developer', link: '/guides/mod-developer' },
            { text: 'Mod Release', link: '/guides/mod-release' },
            { text: 'Mod Release (CN)', link: '/guides/mod-release_cn' },
            { text: 'Runtime Integrator', link: '/guides/runtime-integrator' },
          ],
        },
        {
          text: 'Cookbook',
          items: [
            { text: 'Quick Recipes', link: '/cookbook/quick-recipes' },
          ],
        },
        {
          text: 'Reference',
          items: [
            { text: 'SDK', link: '/reference/sdk' },
            { text: 'Runtime', link: '/reference/runtime' },
            { text: 'Protocol', link: '/reference/protocol' },
            { text: 'Error Codes', link: '/reference/error-codes' },
            { text: 'Provider Matrix', link: '/reference/provider-matrix' },
            { text: 'Compatibility Matrix', link: '/reference/compatibility-matrix' },
            { text: 'FAQ', link: '/reference/faq' },
          ],
        },
        {
          text: 'Architecture',
          items: [
            { text: 'Overview', link: '/architecture/' },
            { text: 'Spec Map', link: '/architecture/spec-map' },
            { text: 'Realm Interconnect Paradigm', link: '/architecture/realm-interconnect-paradigm' },
            { text: 'MCP Agent Interaction (CN)', link: '/architecture/mcp-agent-interaction_cn' },
          ],
        },
        {
          text: 'Contribute',
          items: [
            { text: 'Contribution Guide', link: '/contribute/' },
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
