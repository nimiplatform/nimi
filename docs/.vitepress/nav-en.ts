import type { DefaultTheme } from 'vitepress'

export const navEn: DefaultTheme.NavItem[] = [
  { text: 'Start', link: '/start/' },
  {
    text: 'Docs',
    items: [
      {
        text: 'Core',
        items: [
          { text: 'Platform', link: '/platform/' },
          { text: 'Runtime', link: '/runtime/' },
          { text: 'SDK', link: '/sdk/' },
          { text: 'Desktop', link: '/desktop/' },
        ],
      },
      {
        text: 'Worlds & Embodiment',
        items: [
          { text: 'Realm', link: '/realm/' },
          { text: 'Avatar', link: '/avatar/' },
          { text: 'Cognition', link: '/cognition/' },
        ],
      },
      {
        text: 'Methodology',
        items: [
          { text: 'Nimi Coding', link: '/nimicoding/' },
        ],
      },
    ],
  },
  { text: 'Reference', link: '/reference/' },
]
