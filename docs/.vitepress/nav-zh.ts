import type { DefaultTheme } from 'vitepress'

export const navZh: DefaultTheme.NavItem[] = [
  { text: '用户指南', link: '/zh/user/' },
  { text: '应用开发', link: '/zh/app-dev/' },
  { text: 'Mod 开发', link: '/zh/mod-dev/' },
  {
    text: '更多',
    items: [
      { text: 'Runtime 集成', link: '/zh/guides/runtime-integrator' },
      { text: '参考手册', link: '/zh/reference/sdk' },
      { text: '架构', link: '/zh/architecture/' },
      { text: '参与贡献', link: '/zh/contribute/' },
    ],
  },
]
