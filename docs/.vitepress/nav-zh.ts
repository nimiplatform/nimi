import type { DefaultTheme } from 'vitepress'

export const navZh: DefaultTheme.NavItem[] = [
  { text: '开始', link: '/zh/start/' },
  {
    text: '文档',
    items: [
      {
        text: '核心',
        items: [
          { text: '平台', link: '/zh/platform/' },
          { text: 'Runtime', link: '/zh/runtime/' },
          { text: 'SDK', link: '/zh/sdk/' },
          { text: '桌面端', link: '/zh/desktop/' },
        ],
      },
      {
        text: '世界与具身',
        items: [
          { text: 'Realm', link: '/zh/realm/' },
          { text: 'Avatar', link: '/zh/avatar/' },
          { text: 'Cognition', link: '/zh/cognition/' },
        ],
      },
      {
        text: '方法论',
        items: [
          { text: 'Nimi Coding', link: '/zh/nimicoding/' },
        ],
      },
    ],
  },
  { text: '参考', link: '/zh/reference/' },
]
