import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'Nimi',
  description: 'Documentation for using, building with, and extending Nimi — the open-source AI runtime.',

  cleanUrls: true,
  lastUpdated: true,
  ignoreDeadLinks: true,

  rewrites: {
    'getting-started/README.md': 'getting-started/index.md',
    'architecture/README.md': 'architecture/index.md',
    'architecture/ssot.md': 'architecture/spec-map.md',
    'sdk/README.md': 'reference/sdk.md',
    'protocol/README.md': 'reference/protocol.md',
    'mods/README.md': 'mod-dev/guide.md',
    'error-codes.md': 'reference/error-codes.md',
    'faq.md': 'user/faq.md',
    'examples/README.md': 'app-dev/recipes.md',
  },

  themeConfig: {
    nav: [
      { text: 'Nimi Coding', link: '/nimi-coding' },
      { text: 'Users', link: '/user/' },
      { text: 'App Developers', link: '/app-dev/' },
      { text: 'Mod Developers', link: '/mod-dev/' },
      {
        text: 'More',
        items: [
          { text: 'Runtime Integrator', link: '/guides/runtime-integrator' },
          { text: 'Reference', link: '/reference/sdk' },
          { text: 'Architecture', link: '/architecture/' },
          { text: 'Contribute', link: '/contribute/' },
        ],
      },
    ],

    sidebar: {
      '/nimi-coding': [
        {
          text: 'Nimi Coding',
          items: [
            { text: 'Nimi Coding', link: '/nimi-coding' },
            { text: 'Nimi Coding (CN)', link: '/nimi-coding_cn' },
          ],
        },
        {
          text: 'Architecture',
          items: [
            { text: 'Overview', link: '/architecture/' },
            { text: 'Spec Map', link: '/architecture/spec-map' },
          ],
        },
      ],

      '/user/': [
        {
          text: 'Using Nimi',
          items: [
            { text: 'Quickstart', link: '/user/' },
            { text: 'Install', link: '/user/install' },
            { text: 'CLI Commands', link: '/user/cli' },
            { text: 'Cloud Providers', link: '/user/providers' },
            { text: 'Models', link: '/user/models' },
            { text: 'Desktop App', link: '/user/desktop' },
            { text: 'Troubleshooting', link: '/user/troubleshooting' },
            { text: 'FAQ', link: '/user/faq' },
          ],
        },
      ],

      '/app-dev/': [
        {
          text: 'App Development',
          items: [
            { text: 'Overview', link: '/app-dev/' },
            { text: 'SDK Setup', link: '/app-dev/sdk-setup' },
            { text: 'App Developer Guide', link: '/app-dev/guide' },
            { text: 'Recipes', link: '/app-dev/recipes' },
            { text: 'Production Checklist', link: '/app-dev/production-checklist' },
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
          ],
        },
      ],

      '/mod-dev/': [
        {
          text: 'Mod Development',
          items: [
            { text: 'Overview', link: '/mod-dev/' },
            { text: 'Development Guide', link: '/mod-dev/guide' },
            { text: 'Release & Submission', link: '/mod-dev/release' },
            { text: 'Release Guide (CN)', link: '/mod-dev/release_cn' },
          ],
        },
        {
          text: 'Reference',
          items: [
            { text: 'SDK (Mod surface)', link: '/reference/sdk' },
            { text: 'Error Codes', link: '/reference/error-codes' },
            { text: 'Compatibility Matrix', link: '/reference/compatibility-matrix' },
          ],
        },
      ],

      '/guides/': [
        {
          text: 'Guides',
          items: [
            { text: 'Runtime Integrator', link: '/guides/runtime-integrator' },
          ],
        },
        {
          text: 'Related',
          items: [
            { text: 'Runtime Reference', link: '/reference/runtime' },
            { text: 'Provider Matrix', link: '/reference/provider-matrix' },
          ],
        },
      ],

      '/reference/': [
        {
          text: 'Reference',
          items: [
            { text: 'SDK', link: '/reference/sdk' },
            { text: 'Runtime', link: '/reference/runtime' },
            { text: 'Protocol', link: '/reference/protocol' },
            { text: 'Error Codes', link: '/reference/error-codes' },
            { text: 'Provider Matrix', link: '/reference/provider-matrix' },
            { text: 'Compatibility Matrix', link: '/reference/compatibility-matrix' },
          ],
        },
      ],

      '/architecture/': [
        {
          text: 'Architecture',
          items: [
            { text: 'Overview', link: '/architecture/' },
            { text: 'Nimi Coding', link: '/nimi-coding' },
            { text: 'Spec Map', link: '/architecture/spec-map' },
            { text: 'Realm Interconnect', link: '/architecture/realm-interconnect-paradigm' },
            { text: 'Realm Interconnect (CN)', link: '/architecture/realm-interconnect-paradigm_cn' },
            { text: 'AI Agent Security', link: '/architecture/ai-agent-security-interface' },
            { text: 'AI Agent Security (Summary)', link: '/architecture/ai-agent-security-interface-summary' },
            { text: 'AI Agent Security (CN)', link: '/architecture/ai-agent-security-interface_cn' },
            { text: 'MCP Agent (CN)', link: '/architecture/mcp-agent-interaction_cn' },
          ],
        },
      ],
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/nimiplatform/nimi' },
      { icon: 'discord', link: 'https://discord.gg/BQwHJvPn' },
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
