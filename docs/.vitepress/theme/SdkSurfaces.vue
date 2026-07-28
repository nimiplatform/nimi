<script setup lang="ts">
import { computed, ref } from 'vue'
import { useData } from 'vitepress'

type Tier = 'live' | 'buildout' | 'direction'

interface Surface {
  slug: string
  tier: Tier
  zh: { title: string; desc: string }
  en: { title: string; desc: string }
}

const surfaces: Surface[] = [
  {
    slug: 'delegation-client',
    tier: 'buildout',
    zh: {
      title: '任务委派',
      desc: '在智能体与人之间交接任务，带强类型上下文交接与审计轨迹。',
    },
    en: {
      title: 'Delegation',
      desc: 'Hand tasks between agents and people, with typed context handoff and an audit trail.',
    },
  },
  {
    slug: 'local-environment-projection',
    tier: 'buildout',
    zh: {
      title: '本地环境',
      desc: '将共享环境映射到本地会话 —— 文件、工具与运行时状态。',
    },
    en: {
      title: 'Local Environment',
      desc: 'Project the shared environment into a local session — files, tools, and runtime state.',
    },
  },
  {
    slug: 'ai-config-surface',
    tier: 'buildout',
    zh: {
      title: 'AI 配置',
      desc: '一个配置面统管模型选择、能力路由与 provider 偏好。',
    },
    en: {
      title: 'AI Config',
      desc: 'One config surface for model selection, capability routing, and provider preference.',
    },
  },
  {
    slug: 'wee-projection',
    tier: 'direction',
    zh: {
      title: 'WEE 呈现',
      desc: '把世界执行事件作为强类型事件流式输出，供任意消费者使用。',
    },
    en: {
      title: 'WEE Projection',
      desc: 'Stream world execution events as typed events for any consumer.',
    },
  },
  {
    slug: 'wee-consumer',
    tier: 'direction',
    zh: {
      title: 'WEE 消费',
      desc: '订阅世界执行事件，带回压安全的消费机制。',
    },
    en: {
      title: 'WEE Consumer',
      desc: 'Subscribe to world execution events with backpressure-safe consumption.',
    },
  },
  {
    slug: 'transport-and-error',
    tier: 'live',
    zh: {
      title: '传输与错误',
      desc: '强类型传输契约 + 全 SDK 一致的结构化错误语义。',
    },
    en: {
      title: 'Transport & Error',
      desc: 'Typed transport contracts + structured error semantics consistent across the SDK.',
    },
  },
]

const tierLabel: Record<Tier, { zh: string; en: string }> = {
  live: { zh: '运行中', en: 'Running' },
  buildout: { zh: '构建中', en: 'In build-out' },
  direction: { zh: '平台方向', en: 'Direction' },
}

const { lang } = useData()
const isZh = computed(() => lang.value.startsWith('zh'))
const base = computed(() => (isZh.value ? '/zh/sdk/' : '/sdk/'))

const active = ref(0)
const current = computed(() => surfaces[active.value])

const copy = computed(() =>
  isZh.value
    ? { tagline: 'Open-source AI runtime for apps.', cta: '查看 SDK 参考' }
    : { tagline: 'Open-source AI runtime for apps.', cta: 'View SDK reference' },
)

function tx(s: Surface) {
  return isZh.value ? s.zh : s.en
}
function tier(s: Surface) {
  return isZh.value ? tierLabel[s.tier].zh : tierLabel[s.tier].en
}
</script>

<template>
  <section class="sdk-surfaces">
    <ul class="sdk-list" role="tablist">
      <li
        v-for="(s, i) in surfaces"
        :key="s.slug"
        class="sdk-item"
        :class="{ 'is-active': i === active }"
        role="tab"
        :aria-selected="i === active"
        tabindex="0"
        @mouseenter="active = i"
        @focus="active = i"
        @click="active = i"
      >
        <a class="sdk-item-link" :href="base + s.slug">
          <span class="sdk-item-title">{{ tx(s).title }}</span>
          <span class="sdk-item-desc">{{ tx(s).desc }}</span>
        </a>
      </li>
    </ul>

    <div class="sdk-showcase">
      <div class="sdk-card">
        <div class="sdk-card-brand">
          <span class="sdk-card-mark">Nimi</span>
          <span class="sdk-card-tagline">{{ copy.tagline }}</span>
        </div>
        <div class="sdk-card-detail">
          <span class="sdk-card-badge" :data-tier="current.tier">{{ tier(current) }}</span>
          <span class="sdk-card-name">{{ tx(current).title }}</span>
          <span class="sdk-card-desc">{{ tx(current).desc }}</span>
        </div>
      </div>
      <a class="sdk-card-cta" :href="base + current.slug">
        {{ copy.cta }} <span aria-hidden="true">→</span>
      </a>
    </div>
  </section>
</template>

<style scoped>
.sdk-surfaces {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.05fr);
  gap: 40px;
  align-items: start;
  margin: 28px 0 44px;
}

/* On wide viewports the docs prose column is capped at 688px. The SDK
   landing is a hero, so let it break out rightward into the space freed
   by `aside: false`. Left edge stays aligned with the prose; the width
   is bounded so it never overlaps the sidebar or overflows the viewport. */
@media (min-width: 960px) {
  .sdk-surfaces {
    width: min(1040px, calc(100vw - 420px));
  }
}

/* Left: feature list */
.sdk-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.sdk-item {
  border: 1px solid transparent;
  border-radius: 12px;
  transition: background-color 0.18s ease, border-color 0.18s ease,
    box-shadow 0.18s ease, transform 0.18s ease;
  position: relative;
  cursor: pointer;
}
.sdk-item-link {
  display: block;
  padding: 14px 18px 14px 20px;
  text-decoration: none;
  color: inherit;
  font-weight: inherit;
}
.sdk-item-title {
  display: block;
  font-size: 16px;
  font-weight: 600;
  color: var(--vp-c-text-2);
  transition: color 0.18s ease;
  line-height: 1.4;
}
.sdk-item-desc {
  display: block;
  margin-top: 6px;
  font-size: 13.5px;
  line-height: 1.6;
  color: var(--vp-c-text-3);
}
.sdk-item:hover .sdk-item-title,
.sdk-item.is-active .sdk-item-title {
  color: var(--vp-c-text-1);
}
.sdk-item.is-active {
  background: var(--vp-c-bg);
  border-color: var(--vp-c-divider);
  box-shadow: 0 6px 24px -12px rgba(0, 0, 0, 0.25);
}
.sdk-item.is-active::before {
  content: '';
  position: absolute;
  left: 0;
  top: 14px;
  bottom: 14px;
  width: 3px;
  border-radius: 3px;
  background: var(--vp-c-brand-1);
}

/* Right: showcase */
.sdk-showcase {
  position: sticky;
  top: 96px;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 16px;
}
.sdk-card {
  width: 100%;
  border-radius: 18px;
  padding: 14px;
  background: linear-gradient(180deg, #11161d 0%, #0a0d12 100%);
  border: 1px solid rgba(255, 255, 255, 0.06);
  box-shadow: 0 30px 60px -30px rgba(8, 12, 18, 0.7);
}
.sdk-card-brand {
  border-radius: 12px;
  padding: 56px 24px 64px;
  text-align: center;
  background: radial-gradient(
    120% 90% at 50% 0%,
    rgba(255, 255, 255, 0.05) 0%,
    rgba(255, 255, 255, 0) 60%
  );
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.04);
}
.sdk-card-mark {
  display: block;
  font-family: var(--vp-font-family-mono);
  font-size: 34px;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: #f2f5f8;
}
.sdk-card-tagline {
  display: block;
  margin-top: 14px;
  font-family: var(--vp-font-family-mono);
  font-size: 12px;
  letter-spacing: 0.02em;
  color: var(--vp-c-brand-1);
  opacity: 0.85;
}
.sdk-card-detail {
  padding: 16px 12px 6px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.sdk-card-badge {
  align-self: flex-start;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.02em;
  padding: 3px 9px;
  border-radius: 999px;
  color: #cdd6e0;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.08);
}
.sdk-card-badge[data-tier='live'] {
  color: #6ee7b7;
  background: rgba(16, 185, 129, 0.12);
  border-color: rgba(16, 185, 129, 0.3);
}
.sdk-card-badge[data-tier='direction'] {
  color: #93c5fd;
  background: rgba(59, 130, 246, 0.12);
  border-color: rgba(59, 130, 246, 0.3);
}
.sdk-card-name {
  font-size: 16px;
  font-weight: 600;
  color: #eef2f6;
}
.sdk-card-desc {
  font-size: 13px;
  line-height: 1.65;
  color: #9aa7b4;
}
.sdk-card-cta {
  font-size: 14px;
  font-weight: 600;
  color: var(--vp-c-brand-1);
  text-decoration: none;
  transition: color 0.18s ease;
}
.sdk-card-cta:hover {
  color: var(--vp-c-brand-2);
}
.sdk-card-cta span {
  display: inline-block;
  transition: transform 0.18s ease;
}
.sdk-card-cta:hover span {
  transform: translateX(3px);
}

@media (max-width: 768px) {
  .sdk-surfaces {
    grid-template-columns: 1fr;
    gap: 24px;
  }
  .sdk-showcase {
    position: static;
    order: -1;
    align-items: stretch;
  }
  .sdk-card-brand {
    padding: 40px 20px 44px;
  }
}
</style>
