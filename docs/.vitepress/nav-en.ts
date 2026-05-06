import type { DefaultTheme } from 'vitepress'

export const navEn: DefaultTheme.NavItem[] = [
  { text: 'Start', link: '/start/' },
  { text: 'Platform', link: '/platform/' },
  { text: 'Runtime', link: '/runtime/' },
  { text: 'SDK', link: '/sdk/' },
  { text: 'Desktop', link: '/desktop/' },
  { text: 'Nimi Coding', link: '/nimicoding/' },
  {
    text: 'More',
    items: [
      { text: 'Realm', link: '/realm/' },
      { text: 'Avatar', link: '/avatar/' },
      { text: 'Cognition', link: '/cognition/' },
      { text: 'Personas', link: '/start/personas' },
    ],
  },
  {
    text: 'Reference',
    items: [
      { text: 'Reference Overview', link: '/reference/' },
      { text: 'Glossary', link: '/reference/glossary' },
      { text: 'World Fields', link: '/reference/world-fields' },
      { text: 'Agent Fields', link: '/reference/agent-fields' },
      { text: 'Six Primitives', link: '/reference/six-primitives' },
      { text: 'State Machines', link: '/reference/state-machines' },
      { text: 'Authority Domains', link: '/reference/authority-domains' },
      { text: 'Error Ownership', link: '/reference/error-ownership' },
      { text: 'Compatibility Posture', link: '/reference/compatibility-posture' },
      { text: 'Forbidden Claims', link: '/reference/forbidden-claims' },
      { text: 'Spec Map', link: '/reference/spec-map' },
    ],
  },
]
