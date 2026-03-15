import type { DefaultTheme } from 'vitepress'

export const sidebarZh: DefaultTheme.Sidebar = {
  '/zh/nimi-coding': [
    {
      text: 'Nimi Coding',
      items: [
        { text: 'Nimi Coding', link: '/zh/nimi-coding' },
      ],
    },
    {
      text: '架构',
      items: [
        { text: '概览', link: '/zh/architecture/' },
        { text: 'Spec 地图', link: '/zh/architecture/spec-map' },
      ],
    },
  ],

  '/zh/user/': [
    {
      text: '使用 Nimi',
      items: [
        { text: '快速开始', link: '/zh/user/' },
        { text: '安装', link: '/zh/user/install' },
        { text: 'CLI 命令', link: '/zh/user/cli' },
        { text: '云端 Provider', link: '/zh/user/providers' },
        { text: '模型管理', link: '/zh/user/models' },
        { text: '桌面应用', link: '/zh/user/desktop' },
        { text: '故障排查', link: '/zh/user/troubleshooting' },
        { text: '常见问题', link: '/zh/user/faq' },
      ],
    },
  ],

  '/zh/app-dev/': [
    {
      text: '应用开发',
      items: [
        { text: '概览', link: '/zh/app-dev/' },
        { text: 'SDK 安装', link: '/zh/app-dev/sdk-setup' },
        { text: '开发指南', link: '/zh/app-dev/guide' },
        { text: '示例集', link: '/zh/app-dev/recipes' },
        { text: '生产检查清单', link: '/zh/app-dev/production-checklist' },
      ],
    },
    {
      text: '参考手册',
      items: [
        { text: 'SDK', link: '/zh/reference/sdk' },
        { text: 'Runtime', link: '/zh/reference/runtime' },
        { text: '协议', link: '/zh/reference/protocol' },
        { text: '错误码', link: '/zh/reference/error-codes' },
        { text: 'Provider 矩阵', link: '/zh/reference/provider-matrix' },
        { text: '兼容性矩阵', link: '/zh/reference/compatibility-matrix' },
      ],
    },
  ],

  '/zh/mod-dev/': [
    {
      text: 'Mod 开发',
      items: [
        { text: '概览', link: '/zh/mod-dev/' },
        { text: '开发指南', link: '/zh/mod-dev/guide' },
        { text: '发布与提交', link: '/zh/mod-dev/release' },
      ],
    },
    {
      text: '参考手册',
      items: [
        { text: 'SDK (Mod 接口)', link: '/zh/reference/sdk' },
        { text: '错误码', link: '/zh/reference/error-codes' },
        { text: '兼容性矩阵', link: '/zh/reference/compatibility-matrix' },
      ],
    },
  ],

  '/zh/guides/': [
    {
      text: '指南',
      items: [
        { text: 'Runtime 集成指南', link: '/zh/guides/runtime-integrator' },
      ],
    },
    {
      text: '相关',
      items: [
        { text: 'Runtime 参考', link: '/zh/reference/runtime' },
        { text: 'Provider 矩阵', link: '/zh/reference/provider-matrix' },
      ],
    },
  ],

  '/zh/reference/': [
    {
      text: '参考手册',
      items: [
        { text: 'SDK', link: '/zh/reference/sdk' },
        { text: 'Runtime', link: '/zh/reference/runtime' },
        { text: '协议', link: '/zh/reference/protocol' },
        { text: '错误码', link: '/zh/reference/error-codes' },
        { text: 'Provider 矩阵', link: '/zh/reference/provider-matrix' },
        { text: '兼容性矩阵', link: '/zh/reference/compatibility-matrix' },
      ],
    },
  ],

  '/zh/contribute/': [
    {
      text: '参与贡献',
      items: [
        { text: '概览', link: '/zh/contribute/' },
        { text: '开源发布', link: '/zh/contribute/open-source-release' },
      ],
    },
  ],

  '/zh/architecture/': [
    {
      text: '架构',
      items: [
        { text: '概览', link: '/zh/architecture/' },
        { text: 'Nimi Coding', link: '/zh/nimi-coding' },
        { text: 'Spec 地图', link: '/zh/architecture/spec-map' },
        { text: 'Realm 互联范式', link: '/zh/architecture/realm-interconnect-paradigm' },
        { text: 'AI Agent 安全接口', link: '/zh/architecture/ai-agent-security-interface' },
        { text: 'AI Agent 安全接口（摘要）', link: '/zh/architecture/ai-agent-security-interface-summary' },
        { text: 'MCP Agent 交互架构', link: '/zh/architecture/mcp-agent-interaction' },
      ],
    },
  ],
}
