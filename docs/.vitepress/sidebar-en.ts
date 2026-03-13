import type { DefaultTheme } from 'vitepress'

export const sidebarEn: DefaultTheme.Sidebar = {
  '/nimi-coding': [
    {
      text: 'Nimi Coding',
      items: [
        { text: 'Nimi Coding', link: '/nimi-coding' },
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
        { text: 'AI Agent Security', link: '/architecture/ai-agent-security-interface' },
        { text: 'AI Agent Security (Summary)', link: '/architecture/ai-agent-security-interface-summary' },
        { text: 'MCP Agent Interaction', link: '/architecture/mcp-agent-interaction' },
      ],
    },
  ],
}
