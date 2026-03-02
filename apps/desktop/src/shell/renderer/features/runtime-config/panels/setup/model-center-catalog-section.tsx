import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  localAiRuntime,
  type LocalAiCatalogItemDescriptor,
  type LocalAiInstallPlanDescriptor,
  type LocalAiVerifiedModelDescriptor,
} from '@runtime/local-ai-runtime';
import { Button, Input } from '../primitives';
import { CAPABILITY_OPTIONS, type CapabilityOption } from './model-center-utils';

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
    <>
      <div className="space-y-3 rounded-[10px] border border-indigo-100 bg-indigo-50 p-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold text-indigo-900">Search Models (Verified + Hugging Face)</p>
          <Button
            variant="secondary"
            size="sm"
            disabled={loadingCatalog}
            onClick={() => void refreshCatalogItems({ query: catalogQuery, capability: catalogCapability })}
          >
            {loadingCatalog ? 'Searching...' : 'Search'}
          </Button>
        </div>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-[2fr,1fr]">
          <Input
            label="Catalog Query"
            value={catalogQuery}
            onChange={setCatalogQuery}
            placeholder="Search repo/model/task..."
          />
          <div>
            <label className="mb-1.5 block text-sm font-medium text-indigo-900">Capability</label>
            <select
              value={catalogCapability}
              onChange={(event) => setCatalogCapability((event.target.value || 'all') as 'all' | CapabilityOption)}
              className="h-[46px] w-full rounded-[10px] border border-indigo-200 bg-white px-3 text-sm text-indigo-900 outline-none"
            >
              <option value="all">all</option>
              {CAPABILITY_OPTIONS.map((capability) => (
                <option key={`catalog-capability-${capability}`} value={capability}>{capability}</option>
              ))}
            </select>
          </div>
        </div>
        {catalogItems.length === 0 ? (
          <p className="text-[11px] text-indigo-800">
            {loadingCatalog ? 'Searching catalog...' : 'No catalog model matched your query.'}
          </p>
        ) : (
          <div className="space-y-2">
            {catalogItems.map((item) => {
              const selected = selectedCatalogItemId === item.itemId;
              return (
                <button
                  key={`catalog-item-${item.itemId}`}
                  type="button"
                  onClick={() => setSelectedCatalogItemId(item.itemId)}
                  className={`w-full rounded-md border p-2 text-left ${
                    selected
                      ? 'border-indigo-300 bg-white'
                      : 'border-indigo-100 bg-indigo-50/40 hover:bg-white'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-xs font-semibold text-indigo-900">{item.title || item.modelId}</p>
                      <p className="text-[11px] text-indigo-800">{item.modelId}</p>
                      <p className="text-[11px] text-indigo-700">
                        {item.source === 'verified' ? 'Verified' : 'HF'} · {item.engine} · {(item.capabilities || []).join(', ') || 'chat'}
                      </p>
                    </div>
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                      item.installAvailable
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-amber-100 text-amber-800'
                    }`}
                    >
                      {item.installAvailable ? 'Installable' : 'Needs Manual'}
                    </span>
                  </div>
                  {item.description ? (
                    <p className="mt-1 text-[11px] text-indigo-700">{item.description}</p>
                  ) : null}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {selectedCatalogItem ? (
        <div className="space-y-2 rounded-[10px] border border-indigo-100 bg-white p-3">
          <p className="text-xs font-semibold text-indigo-900">Install Plan Confirmation</p>
          {loadingPlanPreview ? (
            <p className="text-[11px] text-indigo-700">Resolving install plan...</p>
          ) : !planPreview ? (
            <p className="text-[11px] text-amber-700">Install plan unavailable. Try another model or use Advanced install.</p>
          ) : (
            <div className="space-y-2">
              <p className="text-[11px] text-indigo-700">
                {planPreview.modelId} · {planPreview.engine} · {planPreview.engineRuntimeMode}
              </p>
              <p className="text-[11px] text-indigo-700">
                files={planPreview.files.length} · endpoint={planPreview.endpoint}
              </p>
              {planPreview.warnings.length > 0 ? (
                <p className="text-[11px] text-amber-700">{planPreview.warnings.join(' ; ')}</p>
              ) : null}
              <div className="flex items-center gap-2">
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
                >
                  {installingCatalogItemId === selectedCatalogItem.itemId ? 'Installing...' : 'Install from Catalog'}
                </Button>
              </div>
            </div>
          )}
        </div>
      ) : null}

      <div className="space-y-2 rounded-[10px] border border-emerald-100 bg-emerald-50 p-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold text-emerald-900">Verified Quick Picks</p>
          <Button
            variant="secondary"
            size="sm"
            disabled={loadingVerifiedModels}
            onClick={() => void refreshVerifiedModels()}
          >
            {loadingVerifiedModels ? 'Refreshing...' : 'Refresh Verified'}
          </Button>
        </div>
        <Input
          label="Search Verified Models"
          value={verifiedModelQuery}
          onChange={setVerifiedModelQuery}
          placeholder="Search by title/model/tag..."
        />
        {filteredVerifiedModels.length === 0 ? (
          <p className="text-[11px] text-emerald-800">
            {loadingVerifiedModels ? 'Loading verified models...' : 'No verified model matched your query.'}
          </p>
        ) : (
          <div className="space-y-2">
            {filteredVerifiedModels.map((item) => {
              const installing = installingVerifiedTemplateId === item.templateId;
              return (
                <div key={`verified-model-${item.templateId}`} className="rounded-md border border-emerald-200 bg-white p-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-xs font-semibold text-emerald-900">{item.title}</p>
                      <p className="text-[11px] text-emerald-700">{item.modelId}</p>
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
                    >
                      {installing ? 'Installing...' : 'One-Click Install'}
                    </Button>
                  </div>
                  {item.description ? (
                    <p className="mt-1 text-[11px] text-emerald-700">{item.description}</p>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
