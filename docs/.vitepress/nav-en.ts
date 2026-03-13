import type { DefaultTheme } from 'vitepress'

export const navEn: DefaultTheme.NavItem[] = [
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
]
