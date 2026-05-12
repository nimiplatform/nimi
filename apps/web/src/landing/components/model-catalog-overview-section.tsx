import { useEffect, useMemo, useRef } from 'react';
import anthropicLogo from '../assets/provider-logos/anthropic.png';
import dashscopeLogo from '../assets/provider-logos/dashscope.svg';
import deepseekLogo from '../assets/provider-logos/deepseek.png';
import googleGeminiLogo from '../assets/provider-logos/googlegemini.svg';
import kimiLogo from '../assets/provider-logos/kimi.ico';
import openaiLogo from '../assets/provider-logos/openai.png';
import volcengineLogo from '../assets/provider-logos/volcengine.png';
import type { LandingContent } from '../content/landing-content.js';
import {
  ADMITTED_PROVIDERS,
  PROVIDER_CAPABILITIES,
  type AdmittedCapability,
  type AdmittedProvider,
  type AdmittedRuntimePlane,
} from '../generated/index.js';

export type ModelCatalogOverviewSectionProps = {
  content: LandingContent['modelCatalog'];
  query: string;
  onQueryChange: (query: string) => void;
};

// Provider logo asset map. Keyed by stable provider id (matches ADMITTED_PROVIDERS[].provider).
// Visual-asset concern, not user-facing string.
const PROVIDER_LOGOS: Readonly<Record<string, string>> = {
  openai: openaiLogo,
  anthropic: anthropicLogo,
  gemini: googleGeminiLogo,
  kimi: kimiLogo,
  deepseek: deepseekLogo,
  dashscope: dashscopeLogo,
  volcengine: volcengineLogo,
};

// JOINed catalog entry shape — combines AdmittedProvider metadata with
// per-provider capabilities + runtimePlane from PROVIDER_CAPABILITIES.
// Per D1.3.3 r2 JOIN policy: LEFT JOIN on provider name; capabilities default
// to empty array, runtimePlane defaults to null if no capability row.
type CatalogEntry = AdmittedProvider & {
  capabilities: ReadonlyArray<AdmittedCapability>;
  runtimePlane: AdmittedRuntimePlane | null;
};

const CAPS_BY_PROVIDER = new Map(PROVIDER_CAPABILITIES.map((cap) => [cap.provider, cap]));

const CATALOG: ReadonlyArray<CatalogEntry> = ADMITTED_PROVIDERS.map((provider) => {
  const cap = CAPS_BY_PROVIDER.get(provider.provider);
  return {
    ...provider,
    capabilities: cap?.capabilities ?? [],
    runtimePlane: cap?.runtimePlane ?? null,
  };
});

function getDisplayName(provider: string, displayNames: Readonly<Record<string, string>>): string {
  const explicit = displayNames[provider];
  if (explicit) return explicit;
  return provider
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function ModelCatalogOverviewSection(props: ModelCatalogOverviewSectionProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const searchShellRef = useRef<HTMLDivElement | null>(null);
  const normalizedQuery = props.query.trim().toLowerCase();
  const displayNames = props.content.providerDisplayNames;

  const marqueeProviders = useMemo(
    () =>
      props.content.marqueeProviderOrder
        .map((providerName) => CATALOG.find((p) => p.provider === providerName))
        .filter(
          (p): p is CatalogEntry =>
            p !== undefined && Object.prototype.hasOwnProperty.call(PROVIDER_LOGOS, p.provider),
        ),
    [props.content.marqueeProviderOrder],
  );

  const dropdownResults = useMemo(() => {
    if (!normalizedQuery) {
      return [];
    }

    return CATALOG.filter((p) => p.runtimePlane === 'remote')
      .filter((p) => {
        const formatted = getDisplayName(p.provider, displayNames).toLowerCase();
        const defaultModel = (p.defaultTextModel ?? '').toLowerCase();
        return (
          p.provider.toLowerCase().includes(normalizedQuery) ||
          formatted.includes(normalizedQuery) ||
          defaultModel.includes(normalizedQuery) ||
          p.capabilities.some((capability) => capability.toLowerCase().includes(normalizedQuery))
        );
      })
      .slice(0, 10);
  }, [normalizedQuery, displayNames]);

  const cloudProviderCount = useMemo(
    () => CATALOG.filter((p) => p.runtimePlane === 'remote').length,
    [],
  );
  const localProviderCount = useMemo(
    () => CATALOG.filter((p) => p.runtimePlane === 'local').length,
    [],
  );
  const modalityCount = useMemo(
    () => new Set(CATALOG.flatMap((p) => p.capabilities)).size,
    [],
  );

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        inputRef.current?.focus();
        return;
      }

      if (event.key === 'Escape' && normalizedQuery) {
        props.onQueryChange('');
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [normalizedQuery, props]);

  useEffect(() => {
    if (!normalizedQuery) {
      return;
    }

    function handlePointerDown(event: MouseEvent | TouchEvent) {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (searchShellRef.current?.contains(target)) {
        return;
      }
      props.onQueryChange('');
    }

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
    };
  }, [normalizedQuery, props]);

  return (
    <section id="catalog" className="overflow-hidden pt-16 pb-8 md:pt-20 md:pb-10">
      <div className="container-nimi">
        <div className="relative overflow-hidden px-5 py-0 md:px-10 md:py-0">
          <div className="pointer-events-none absolute left-1/2 top-0 h-[24rem] w-[52rem] -translate-x-1/2 rounded-full bg-emerald-100/70 blur-3xl" />

          <div className="relative text-center">
            <div className="mb-18 space-y-6">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-600">
                {props.content.kicker}
              </p>
              <h2 className="font-heading text-4xl font-extrabold tracking-tight text-slate-900 md:text-5xl">
                {props.content.title}
              </h2>
              <p className="mx-auto max-w-2xl text-lg text-slate-500">{props.content.subtitle}</p>
            </div>

            <div ref={searchShellRef} className="group relative mx-auto max-w-3xl">
              <div className="absolute -inset-1 rounded-2xl bg-gradient-to-r from-emerald-400 to-teal-400 opacity-0 blur transition duration-500 group-hover:opacity-30" />
              <div className="relative rounded-2xl">
                <div className="relative flex h-16 items-center overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition-shadow hover:shadow-md focus-within:border-emerald-500 focus-within:ring-4 focus-within:ring-emerald-500/20">
                  <div className="pl-6 pr-4 text-slate-400">
                    <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                  </div>
                  <input
                    ref={inputRef}
                    type="text"
                    placeholder={props.content.overview.searchPlaceholder}
                    value={props.query}
                    onChange={(event) => props.onQueryChange(event.target.value)}
                    className="h-full flex-1 bg-transparent text-lg text-slate-800 placeholder:text-slate-400 focus:outline-none"
                    aria-label={props.content.overview.searchPlaceholder}
                  />
                  <div className="pr-6">
                    {props.query ? (
                      <button
                        type="button"
                        onClick={() => props.onQueryChange('')}
                        className="hidden rounded-md border border-slate-200 bg-slate-100 px-2 py-1 text-xs font-medium text-slate-500 transition hover:border-slate-300 hover:text-slate-700 sm:inline-flex"
                      >
                        {props.content.overview.clearSearchLabel}
                      </button>
                    ) : (
                      <kbd className="hidden items-center gap-1 rounded-md border border-slate-200 bg-slate-100 px-2 py-1 text-xs font-medium text-slate-500 sm:inline-flex">
                        {props.content.overview.shortcutLabel}
                      </kbd>
                    )}
                  </div>
                </div>

                {normalizedQuery ? (
                  <div className="absolute left-0 right-0 top-[calc(100%+10px)] z-30 overflow-hidden rounded-[1.5rem] border border-slate-200 bg-white/95 text-left shadow-[0_24px_60px_-30px_rgba(15,23,42,0.28)] nimi-material-glass-regular backdrop-blur-[var(--nimi-backdrop-blur-regular)]">
                    <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                        {dropdownResults.length > 0
                          ? `${dropdownResults.length} ${props.content.overview.matchingProvidersLabel}`
                          : props.content.noResultsTitle}
                      </p>
                      <p className="text-xs text-slate-400">{props.content.overview.liveCatalogLabel}</p>
                    </div>
                    <div className="max-h-80 overflow-y-auto p-2 md:max-h-[22rem]">
                      {dropdownResults.length > 0 ? (
                        <div className="space-y-2">
                          {dropdownResults.map((provider) => (
                            <button
                              key={provider.provider}
                              type="button"
                              onClick={() => props.onQueryChange(getDisplayName(provider.provider, displayNames))}
                              className="block w-full rounded-[1.15rem] border border-transparent px-4 py-4 text-left transition hover:border-slate-200 hover:bg-slate-50"
                            >
                              <div className="flex items-center gap-3">
                                {PROVIDER_LOGOS[provider.provider] ? (
                                  <img
                                    src={PROVIDER_LOGOS[provider.provider]}
                                    alt=""
                                    aria-hidden="true"
                                    className="h-8 w-8 rounded-md object-contain"
                                  />
                                ) : (
                                  <div className="h-8 w-8 rounded-md bg-slate-100" aria-hidden="true" />
                                )}
                                <div>
                                  <div className="text-base font-semibold text-slate-900">{getDisplayName(provider.provider, displayNames)}</div>
                                  <div className="mt-0.5 text-xs text-slate-500">
                                    {provider.capabilities.length} {props.content.providerDetailSuffix}
                                  </div>
                                </div>
                              </div>
                              <div className="mt-3 flex flex-wrap gap-2">
                                {provider.capabilities.slice(0, 6).map((capability) => (
                                  <span
                                    key={`${provider.provider}-${capability}`}
                                    className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600"
                                  >
                                    {props.content.capabilityLabels[capability]}
                                  </span>
                                ))}
                              </div>
                            </button>
                          ))}
                        </div>
                      ) : (
                        <div className="px-4 py-8 text-center">
                          <p className="text-sm text-slate-500">{props.content.noResultsDescription}</p>
                        </div>
                      )}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="mx-auto mt-28 max-w-4xl">
              <div className="grid grid-cols-1 gap-12 divide-slate-200 md:grid-cols-3 md:gap-0 md:divide-x">
                <div className="flex flex-col items-center justify-center">
                  <span className="text-5xl font-black tracking-tight text-slate-900 md:text-6xl">{cloudProviderCount}</span>
                  <span className="mt-3 text-sm font-semibold uppercase tracking-wider text-slate-500">
                    {props.content.overview.cloudProvidersLabel}
                  </span>
                </div>

                <div className="flex flex-col items-center justify-center">
                  <span className="text-5xl font-black tracking-tight text-slate-900 md:text-6xl">{localProviderCount}</span>
                  <span className="mt-3 text-sm font-semibold uppercase tracking-wider text-slate-500">
                    {props.content.overview.localModelsLabel}
                  </span>
                </div>

                <div className="flex flex-col items-center justify-center">
                  <span className="text-5xl font-black tracking-tight text-slate-900 md:text-6xl">{modalityCount}</span>
                  <span className="mt-3 text-sm font-semibold uppercase tracking-wider text-slate-500">
                    {props.content.overview.modalitiesLabel}
                  </span>
                  <span className="mt-1.5 text-xs font-medium tracking-wide text-slate-400">
                    {props.content.overview.modalitiesDescription}
                  </span>
                </div>
              </div>
            </div>

            <div className="mx-auto mt-32 max-w-5xl">
              <p className="mb-10 text-xs font-semibold uppercase tracking-widest text-slate-400">
                {props.content.overview.supportedByLabel}
              </p>

              <div className="model-catalog-mask relative h-14 overflow-hidden">
                <div className="model-catalog-marquee flex w-max items-center gap-16 md:gap-24">
                  {[0, 1].map((loopIndex) => (
                    <div key={loopIndex} className="flex items-center gap-16 md:gap-24">
                      {marqueeProviders.map((provider) => (
                        <div
                          key={`${loopIndex}-${provider.provider}`}
                          className="flex items-center gap-3 text-slate-400 opacity-80 transition-all duration-300 hover:opacity-100"
                        >
                          <img
                            src={PROVIDER_LOGOS[provider.provider]}
                            alt=""
                            aria-hidden="true"
                            className="h-9 w-9 object-contain"
                          />
                          <span className="cursor-default text-2xl font-bold text-slate-400">
                            {getDisplayName(provider.provider, displayNames)}
                          </span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
