import DefaultTheme from 'vitepress/theme'
import type { Theme } from 'vitepress'
import SdkSurfaces from './SdkSurfaces.vue'

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('SdkSurfaces', SdkSurfaces)
  },
} satisfies Theme
