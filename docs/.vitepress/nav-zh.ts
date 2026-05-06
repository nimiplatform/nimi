import type { DefaultTheme } from 'vitepress'

export const navZh: DefaultTheme.NavItem[] = [
  { text: '开始', link: '/zh/start/' },
  { text: '平台', link: '/zh/platform/' },
  { text: 'Runtime', link: '/zh/runtime/' },
  { text: 'SDK', link: '/zh/sdk/' },
  { text: '桌面端', link: '/zh/desktop/' },
  { text: 'Nimi Coding', link: '/zh/nimicoding/' },
  {
    text: '更多',
    items: [
      { text: 'Realm', link: '/zh/realm/' },
      { text: 'Avatar', link: '/zh/avatar/' },
      { text: 'Cognition', link: '/zh/cognition/' },
      { text: '用户画像', link: '/zh/start/personas' },
    ],
  },
  {
    text: '参考',
    items: [
      { text: '参考首页', link: '/zh/reference/' },
      { text: '术语表', link: '/zh/reference/glossary' },
      { text: 'World 字段', link: '/zh/reference/world-fields' },
      { text: 'Agent 字段', link: '/zh/reference/agent-fields' },
      { text: '六个基础协议', link: '/zh/reference/six-primitives' },
      { text: '状态机', link: '/zh/reference/state-machines' },
      { text: '权威域', link: '/zh/reference/authority-domains' },
      { text: '错误归属', link: '/zh/reference/error-ownership' },
      { text: '兼容性姿态', link: '/zh/reference/compatibility-posture' },
      { text: '禁用主张', link: '/zh/reference/forbidden-claims' },
      { text: 'Spec Map', link: '/zh/reference/spec-map' },
    ],
  },
]
