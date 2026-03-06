import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  localAiRuntime,
  type LocalAiCatalogItemDescriptor,
  type LocalAiInstallPlanDescriptor,
  type LocalAiVerifiedModelDescriptor,
} from '@runtime/local-ai-runtime';
import { CAPABILITY_OPTIONS, type CapabilityOption } from './model-center-utils';
import { RuntimeSelect } from '../primitives';

// Icons
function SearchIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function RefreshIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
      <path d="M8 16H3v5" />
    </svg>
  );
}

function CheckIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function DownloadIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function PackageIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m7.5 4.27 9 5.15" />
      <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
      <path d="m3.3 7 8.7 5 8.7-5" />
      <path d="M12 22V12" />
    </svg>
  );
}

function StarIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  );
}

// Button Component
function Button({
  children,
  onClick,
  variant = 'primary',
  size = 'md',
  disabled,
  icon,
}: {
  children?: React.ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md';
  disabled?: boolean;
  icon?: React.ReactNode;
}) {
  const variantClass = variant === 'primary'
    ? 'bg-mint-500 text-white hover:bg-mint-600 disabled:bg-gray-300'
    : variant === 'secondary'
      ? 'border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 disabled:bg-gray-100'
      : 'text-gray-600 hover:bg-gray-50 disabled:text-gray-300';

  const sizeClass = size === 'sm' ? 'px-3 py-1.5 text-xs' : 'px-4 py-2 text-sm';

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-all disabled:cursor-not-allowed hover:shadow-sm ${variantClass} ${sizeClass}`}
    >
      {icon}
      {children}
    </button>
  );
}

// Input Component
function Input({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  disabled,
  icon,
}: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  disabled?: boolean;
  icon?: React.ReactNode;
}) {
  return (
    <div>
      {label && <label className="mb-1.5 block text-sm font-medium text-gray-700">{label}</label>}
      <div className="relative">
        {icon && (
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
            {icon}
          </div>
        )}
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          className={`h-11 w-full rounded-xl border border-mint-100 bg-[#F4FBF8] text-sm text-gray-900 outline-none transition-all placeholder:text-gray-400 focus:border-mint-400 focus:bg-white focus:ring-2 focus:ring-mint-100 disabled:opacity-60 ${icon ? 'pl-10 pr-4' : 'px-4'}`}
        />
      </div>
    </div>
  );
}

export type ModelCenterCatalogSectionProps = {
  onInstallCatalogItem: (item: LocalAiCatalogItemDescriptor) => Promise<void>;
  onInstallVerified: (templateId: string) => Promise<void>;
  onPendingHighlightModel: (modelId: string) => void;
};

export function ModelCenterCatalogSection(props: ModelCenterCatalogSectionProps) {
  const [catalogQuery, setCatalogQuery] = useState('');
  const [catalogCapability, setCatalogCapability] = useState<'all' | CapabilityOption>('all');
  const [catalogItems, setCatalogItems] = useState<LocalAiCatalogItemDescriptor[]>([]);
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [selectedCatalogItemId, setSelectedCatalogItemId] = useState('');
  const [planPreview, setPlanPreview] = useState<LocalAiInstallPlanDescriptor | null>(null);
  const [loadingPlanPreview, setLoadingPlanPreview] = useState(false);
  const [installingCatalogItemId, setInstallingCatalogItemId] = useState('');
  const [verifiedModels, setVerifiedModels] = useState<LocalAiVerifiedModelDescriptor[]>([]);
  const [loadingVerifiedModels, setLoadingVerifiedModels] = useState(false);
  const [verifiedModelQuery, setVerifiedModelQuery] = useState('');
  const [installingVerifiedTemplateId, setInstallingVerifiedTemplateId] = useState('');
  const searchGenerationRef = useRef(0);

  const refreshVerifiedModels = useCallback(async () => {
    setLoadingVerifiedModels(true);
    try {
      const rows = await localAiRuntime.listVerified();
      setVerifiedModels(rows);
    } catch {
      setVerifiedModels([]);
    } finally {
      setLoadingVerifiedModels(false);
    }
  }, []);

  const refreshCatalogItems = useCallback(async (input: {
    query: string;
    capability: 'all' | CapabilityOption;
  }) => {
    const generation = ++searchGenerationRef.current;
    const query = String(input.query).trim();
    const capability = input.capability;
    setLoadingCatalog(true);
    try {
      const rows = await localAiRuntime.searchCatalog({
        query: query || undefined,
        capability: capability === 'all' ? undefined : capability,
        limit: 30,
      });
      if (searchGenerationRef.current !== generation) return;
      setCatalogItems(rows);
      if (rows.length === 0) {
        setSelectedCatalogItemId('');
        setPlanPreview(null);
      } else {
        setSelectedCatalogItemId((prev) => {
          if (rows.some((item) => item.itemId === prev)) return prev;
          return rows[0]?.itemId || '';
        });
      }
    } catch {
      if (searchGenerationRef.current !== generation) return;
      setCatalogItems([]);
      setSelectedCatalogItemId('');
      setPlanPreview(null);
    } finally {
      if (searchGenerationRef.current === generation) {
        setLoadingCatalog(false);
      }
    }
  }, []);

  useEffect(() => {
    void refreshVerifiedModels();
  }, [refreshVerifiedModels]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void refreshCatalogItems({ query: catalogQuery, capability: catalogCapability });
    }, 500);
    return () => {
      clearTimeout(timer);
    };
  }, [catalogCapability, catalogQuery, refreshCatalogItems]);

  useEffect(() => {
    if (!selectedCatalogItemId) {
      setPlanPreview(null);
      return;
    }
    const selected = catalogItems.find((item) => item.itemId === selectedCatalogItemId) || null;
    if (!selected) {
      setPlanPreview(null);
      return;
    }

    let disposed = false;
    void (async () => {
      setLoadingPlanPreview(true);
      try {
        const plan = await localAiRuntime.resolveInstallPlan({
          itemId: selected.itemId,
          source: selected.source,
          templateId: selected.templateId,
          modelId: selected.modelId,
          repo: selected.repo,
          revision: selected.revision,
        });
        if (!disposed) {
          setPlanPreview(plan);
        }
      } catch {
        if (!disposed) {
          setPlanPreview(null);
        }
      } finally {
        if (!disposed) {
          setLoadingPlanPreview(false);
        }
      }
    })();

    return () => {
      disposed = true;
    };
  }, [catalogItems, selectedCatalogItemId]);

  const selectedCatalogItem = useMemo(
    () => catalogItems.find((item) => item.itemId === selectedCatalogItemId) || null,
    [catalogItems, selectedCatalogItemId],
  );

  const filteredVerifiedModels = useMemo(() => {
    const query = String(verifiedModelQuery || '').trim().toLowerCase();
    if (!query) return verifiedModels;
    return verifiedModels.filter((item) => {
      const modelId = String(item.modelId || '').toLowerCase();
      const title = String(item.title || '').toLowerCase();
      const description = String(item.description || '').toLowerCase();
      const tags = (item.tags || []).join(' ').toLowerCase();
      return modelId.includes(query)
        || title.includes(query)
        || description.includes(query)
        || tags.includes(query);
    });
  }, [verifiedModelQuery, verifiedModels]);

  return (
    <div className="space-y-4">
      {/* Catalog Search */}
      <div className="rounded-xl border border-mint-100 bg-mint-50/50 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <PackageIcon className="h-4 w-4 text-mint-600" />
            <p className="text-sm font-semibold text-gray-900">Search Catalog</p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            disabled={loadingCatalog}
            onClick={() => void refreshCatalogItems({ query: catalogQuery, capability: catalogCapability })}
            icon={<RefreshIcon />}
          >
            {loadingCatalog ? 'Searching...' : 'Search'}
          </Button>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[2fr,1fr]">
          <Input
            value={catalogQuery}
            onChange={setCatalogQuery}
            placeholder="Search repo/model/task..."
            icon={<SearchIcon />}
          />
          <div>
            <RuntimeSelect
              value={catalogCapability}
              onChange={(nextCapability) => setCatalogCapability((nextCapability || 'all') as 'all' | CapabilityOption)}
              className="w-full"
              options={[
                { value: 'all', label: 'All Capabilities' },
                ...CAPABILITY_OPTIONS.map((capability) => ({ value: capability, label: capability })),
              ]}
            />
          </div>
        </div>
        {catalogItems.length === 0 ? (
          <p className="text-xs text-gray-500">
            {loadingCatalog ? 'Searching catalog...' : 'No catalog model matched your query.'}
          </p>
        ) : (
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {catalogItems.map((item) => {
              const selected = selectedCatalogItemId === item.itemId;
              return (
                <button
                  key={`catalog-item-${item.itemId}`}
                  type="button"
                  onClick={() => setSelectedCatalogItemId(item.itemId)}
                  className={`w-full rounded-xl border p-3 text-left transition-all ${
                    selected
                      ? 'border-mint-300 bg-mint-50/40 ring-1 ring-mint-200'
                      : 'border-mint-100 bg-white hover:border-mint-200 hover:bg-mint-50/30'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-900 truncate">{item.title || item.modelId}</p>
                      <p className="text-xs text-gray-500">{item.modelId}</p>
                      <p className="text-xs text-gray-400">
                        {item.source === 'verified' ? 'Verified' : 'Hugging Face'} · {item.engine}
                      </p>
                    </div>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                      item.installAvailable
                        ? 'bg-green-100 text-green-700'
                        : 'bg-amber-100 text-amber-700'
                    }`}
                    >
                      {item.installAvailable ? 'Installable' : 'Manual'}
                    </span>
                  </div>
                  {item.description ? (
                    <p className="mt-1 text-xs text-gray-500 line-clamp-2">{item.description}</p>
                  ) : null}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Install Plan Confirmation */}
      {selectedCatalogItem ? (
        <div className="rounded-xl border border-mint-100 bg-white p-4 shadow-sm">
          <p className="text-sm font-semibold text-gray-900 mb-3">Install Plan</p>
          {loadingPlanPreview ? (
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <RefreshIcon className="h-4 w-4 animate-spin" />
              Resolving install plan...
            </div>
          ) : !planPreview ? (
            <div className="flex items-start gap-2 text-sm text-amber-700 bg-amber-50 rounded-lg px-3 py-2">
              <span>Install plan unavailable. Try another model or use Advanced install.</span>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-mint-100 text-mint-600">
                  <CheckIcon className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-900">{planPreview.modelId}</p>
                  <p className="text-xs text-gray-500">{planPreview.engine} · {planPreview.engineRuntimeMode}</p>
                </div>
              </div>
              <div className="text-xs text-gray-500 space-y-1">
                <p>Files: {planPreview.files.length}</p>
                <p>Endpoint: {planPreview.endpoint}</p>
              </div>
              {planPreview.warnings.length > 0 ? (
                <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2">{planPreview.warnings.join(' ; ')}</p>
              ) : null}
              <Button
                variant="primary"
                size="sm"
                disabled={!planPreview.installAvailable || Boolean(installingCatalogItemId)}
                onClick={() => {
                  if (!selectedCatalogItem) return;
                  void (async () => {
                    setInstallingCatalogItemId(selectedCatalogItem.itemId);
                    try {
                      await props.onInstallCatalogItem(selectedCatalogItem);
                      props.onPendingHighlightModel(selectedCatalogItem.modelId);
                    } finally {
                      setInstallingCatalogItemId('');
                    }
                  })();
                }}
                icon={<DownloadIcon />}
              >
                {installingCatalogItemId === selectedCatalogItem.itemId ? 'Installing...' : 'Install from Catalog'}
              </Button>
            </div>
          )}
        </div>
      ) : null}

      {/* Verified Quick Picks */}
      <div className="rounded-xl border border-mint-100 bg-mint-50/30 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <StarIcon className="h-4 w-4 text-mint-600" />
            <p className="text-sm font-semibold text-gray-900">Verified Quick Picks</p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            disabled={loadingVerifiedModels}
            onClick={() => void refreshVerifiedModels()}
            icon={<RefreshIcon />}
          >
            {loadingVerifiedModels ? 'Refreshing...' : 'Refresh'}
          </Button>
        </div>
        <Input
          value={verifiedModelQuery}
          onChange={setVerifiedModelQuery}
          placeholder="Search verified models..."
          icon={<SearchIcon />}
        />
        {filteredVerifiedModels.length === 0 ? (
          <p className="text-xs text-gray-500">
            {loadingVerifiedModels ? 'Loading verified models...' : 'No verified model matched your query.'}
          </p>
        ) : (
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {filteredVerifiedModels.map((item) => {
              const installing = installingVerifiedTemplateId === item.templateId;
              return (
                <div key={`verified-model-${item.templateId}`} className="rounded-xl border border-mint-100 bg-white p-3 transition-colors hover:border-mint-200 hover:bg-mint-50/20">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-900">{item.title}</p>
                      <p className="text-xs text-gray-500">{item.modelId}</p>
                      {item.description ? (
                        <p className="mt-1 text-xs text-gray-400 line-clamp-2">{item.description}</p>
                      ) : null}
                    </div>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={installing || Boolean(installingVerifiedTemplateId)}
                      onClick={() => {
                        void (async () => {
                          setInstallingVerifiedTemplateId(item.templateId);
                          try {
                            await props.onInstallVerified(item.templateId);
                            props.onPendingHighlightModel(item.modelId);
                          } finally {
                            setInstallingVerifiedTemplateId('');
                          }
                        })();
                      }}
                      icon={installing ? undefined : <DownloadIcon />}
                    >
                      {installing ? 'Installing...' : 'Install'}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
