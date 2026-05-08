import { defineConfig } from 'vitepress'
import { navEn } from './nav-en'
import { navZh } from './nav-zh'
import { sidebarEn } from './sidebar-en'
import { sidebarZh } from './sidebar-zh'

export default defineConfig({
  title: 'Nimi',
  description: 'Public docs for the Nimi AI open world platform.',
  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
    ['link', { rel: 'icon', type: 'image/png', sizes: '32x32', href: '/favicon-32x32.png' }],
    ['link', { rel: 'icon', href: '/favicon.ico', sizes: 'any' }],
  ],

  cleanUrls: true,
  lastUpdated: true,

  // Exclude contributor-facing files from the published site.
  // These files document authoring rules for contributors and are not
  // part of the reader-facing docs.
  srcExclude: ['**/AGENTS.md'],

  locales: {
    root: {
      label: 'English',
      lang: 'en',
      themeConfig: {
        nav: navEn,
        sidebar: sidebarEn,
      },
    },
    zh: {
      label: '中文',
      lang: 'zh-CN',
      title: 'Nimi',
      description: 'Nimi AI 开放世界平台公共文档。',
      themeConfig: {
        nav: navZh,
        sidebar: sidebarZh,
        outline: {
          label: '本页目录',
        },
        docFooter: {
          prev: '上一页',
          next: '下一页',
        },
        lastUpdated: {
          text: '最后更新',
        },
        editLink: {
          pattern: 'https://github.com/nimiplatform/nimi/edit/main/docs/:path',
          text: '在 GitHub 上编辑此页',
        },
        returnToTopLabel: '返回顶部',
        sidebarMenuLabel: '菜单',
        darkModeSwitchLabel: '深色模式',
        langMenuLabel: '语言',
      },
    },
  },

  themeConfig: {
    logo: '/logo.svg',

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
      options: {
        locales: {
          zh: {
            translations: {
              button: {
                buttonText: '搜索文档',
                buttonAriaLabel: '搜索文档',
              },
              modal: {
                noResultsText: '无法找到相关结果',
                resetButtonTitle: '清除查询条件',
                footer: {
                  selectText: '选择',
                  navigateText: '切换',
                  closeText: '关闭',
                },
              },
            },
          },
        },
      },
    },

    footer: {
      message: 'Nimi AI open world platform documentation.',
      copyright: 'Copyright 2026-present Nimi Platform',
    },
  },
})
