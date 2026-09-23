import type { CSSProperties } from 'react';
import { PROVIDER_LOGO_SVG, type ProviderLogoKey } from '../assets/provider-logos.js';
import { IdentityTile, type IdentityTileSize } from './identity-tile.js';

/**
 * Brand logo for a cloud provider id from the runtime provider registry.
 * Monochrome marks use `currentColor`, so they follow the theme's text color
 * on light and dark surfaces; full-color marks carry their own palette. A
 * provider without a mark (first-party `nimillm`, `openai_compatible`, niche
 * media vendors) falls back to the deterministic IdentityTile.
 */
const PROVIDER_LOGO_KEY: Readonly<Record<string, ProviderLogoKey>> = Object.freeze({
  anthropic: 'anthropic',
  aws_polly: 'aws-color',
  azure: 'azure-color',
  azure_speech: 'azure-color',
  bedrock: 'bedrock-color',
  cohere: 'cohere-color',
  dashscope: 'alibabacloud-color',
  deepseek: 'deepseek-color',
  elevenlabs: 'elevenlabs',
  fireworks: 'fireworks-color',
  fish_audio: 'fishaudio',
  flux: 'flux',
  gemini: 'gemini-color',
  glm: 'zhipu-color',
  google_cloud_tts: 'googlecloud-color',
  google_veo: 'google-color',
  groq: 'groq',
  hunyuan: 'hunyuan-color',
  ideogram: 'ideogram',
  kimi: 'kimi',
  kling: 'kling-color',
  luma: 'luma-color',
  mimo: 'xiaomimimo',
  minimax: 'minimax-color',
  mistral: 'mistral-color',
  openai: 'openai',
  openai_codex: 'codex-color',
  openrouter: 'openrouter-color',
  perplexity: 'perplexity-color',
  pika: 'pika',
  qianfan: 'baiducloud-color',
  runway: 'runway',
  siliconflow: 'siliconcloud-color',
  spark: 'spark-color',
  spark_reasoning: 'spark-color',
  stability: 'stability-color',
  stepfun: 'stepfun-color',
  together: 'together-color',
  volcengine: 'volcengine-color',
  volcengine_openspeech: 'volcengine-color',
  xai: 'xai',
});

const TILE_CLASS = Object.freeze({
  xs: 'size-6 rounded-md',
  sm: 'size-8 rounded-lg',
  md: 'size-10 rounded-xl',
  lg: 'size-12 rounded-2xl',
} as const);

const MARK_CLASS = Object.freeze({
  xs: 'size-3.5',
  sm: 'size-[18px]',
  md: 'size-[22px]',
  lg: 'size-7',
} as const);

const TILE_STYLE: CSSProperties = {
  background: '#ffffff',
  color: '#1f1f1f',
  boxShadow: 'inset 0 0 0 1px var(--nimi-border-subtle)',
};

function providerLogoMarkup(provider: string): string | null {
  const key = PROVIDER_LOGO_KEY[provider.trim().toLowerCase()];
  return key ? PROVIDER_LOGO_SVG[key] : null;
}

export function hasProviderLogo(provider: string): boolean {
  return providerLogoMarkup(provider) !== null;
}

export function ProviderLogoTile({
  provider,
  label,
  size = 'md',
  className = '',
}: {
  /** Runtime provider id (`anthropic`, `fish_audio`, …) or connector vendor. */
  readonly provider: string;
  /** Human label; used for the fallback monogram. */
  readonly label: string;
  readonly size?: IdentityTileSize;
  readonly className?: string;
}) {
  const markup = providerLogoMarkup(provider);
  if (!markup) {
    return <IdentityTile seed={provider} label={label} size={size} className={className} />;
  }
  return (
    <span
      aria-hidden="true"
      className={`relative inline-flex shrink-0 select-none items-center justify-center ${TILE_CLASS[size]} ${className}`}
      style={TILE_STYLE}
      data-provider-logo={provider.trim().toLowerCase()}
    >
      <span className={`inline-flex [&>svg]:size-full ${MARK_CLASS[size]}`} dangerouslySetInnerHTML={{ __html: markup }} />
    </span>
  );
}
