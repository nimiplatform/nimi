import { useCallback, useEffect, useMemo, useState } from 'react';
import { APP_PAGE_TITLE_CLASS, APP_SECTION_TITLE_CLASS } from '@renderer/components/typography.js';
import type { RuntimeConfigStateV11 } from '@renderer/features/runtime-config/runtime-config-state-types';
import {
  DEFAULT_OPENAI_ENDPOINT_V11,
  getVendorLabelV11,
  VENDOR_ORDER_V11,
  randomIdV11,
  type ApiVendor,
} from '@renderer/features/runtime-config/runtime-config-state-types';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import {
  sdkCreateConnector,
  sdkDeleteConnector,
  sdkUpdateConnector,
  sdkListConnectors,
  sdkListProviderCatalog,
  resolveProviderEndpoint,
  vendorToProvider,
} from './runtime-config-connector-sdk-service';
import {
  inferVendorFromEndpoint,
  addConnectorToState,
  removeSelectedConnector,
  updateConnectorField,
  replaceConnectorsInState,
} from './runtime-config-connector-actions';
import { formatRuntimeConfigErrorBanner } from './runtime-config-connector-error';
import type { RuntimeConfigPanelControllerModel } from './runtime-config-panel-types';
import { RuntimeSelect, StatusBadge, renderModelChips } from './runtime-config-primitives';

// Icons
function CloudIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.5 19c0-3.037-2.463-5.5-5.5-5.5S6.5 15.963 6.5 19" />
      <path d="M17.5 19c2.485 0 4.5-2.015 4.5-4.5S19.985 10 17.5 10c-.186 0-.367.012-.544.035C16.473 6.607 13.487 4 10 4 6.134 4 3 7.134 3 11c0 .37.03.732.086 1.084A4.496 4.496 0 0 0 2 19.5C2 21.985 4.015 24 6.5 24h11c2.485 0 4.5-2.015 4.5-4.5S19.985 15 17.5 15" />
    </svg>
  );
}

function PlusIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function TrashIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

function BoltIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  );
}

function KeyIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m21 2-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4" />
    </svg>
  );
}

function ServerIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
      <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
      <line x1="6" y1="6" x2="6.01" y2="6" />
      <line x1="6" y1="18" x2="6.01" y2="18" />
    </svg>
  );
}

function SearchIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function EyeIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
      <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
      <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
      <line x1="2" y1="2" x2="22" y2="22" />
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

type CloudPageProps = {
  model: RuntimeConfigPanelControllerModel;
  state: RuntimeConfigStateV11;
};

// Layout Components
function PageShell({
  title,
  description,
  children,
}: {
  title?: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-6">
      {title && (
        <div className="flex h-14 shrink-0 items-center bg-white px-6">
          <div className="flex items-end gap-3">
            <h2 className={APP_PAGE_TITLE_CLASS}>{title}</h2>
            {description && <p className="text-xs text-gray-500 pb-[3px]">{description}</p>}
          </div>
        </div>
      )}
      {children}
    </div>
  );
}

function SectionTitle({ children, description }: { children: React.ReactNode; description?: string }) {
  return (
    <div>
      <h3 className={APP_SECTION_TITLE_CLASS}>{children}</h3>
      {description && <p className="mt-0.5 text-xs text-gray-500">{description}</p>}
    </div>
  );
}

function SettingRow({
  icon,
  title,
  description,
  action,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between px-5 py-4 transition-colors hover:bg-white/80">
      <div className="flex items-center gap-4">
        {icon && (
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-mint-100 text-mint-600">
            {icon}
          </div>
        )}
        <div>
          <p className="text-sm font-medium text-gray-900">{title}</p>
          {description && <p className="text-xs text-gray-500">{description}</p>}
        </div>
      </div>
      {action && <div className="flex items-center gap-2">{action}</div>}
    </div>
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
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
  disabled?: boolean;
  icon?: React.ReactNode;
}) {
  const variantClass = variant === 'primary'
    ? 'bg-mint-500 text-white hover:bg-mint-600 disabled:bg-gray-300'
    : variant === 'secondary'
      ? 'border border-mint-200 bg-white text-mint-700 hover:bg-mint-50 disabled:bg-gray-100 disabled:text-gray-400'
      : variant === 'danger'
        ? 'border border-red-200 bg-red-50 text-red-600 hover:bg-red-100 disabled:opacity-50'
        : 'text-mint-700 hover:bg-mint-50 disabled:text-gray-300';

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

export function CloudPage({ model, state }: CloudPageProps) {
  const { selectedConnector, orderedConnectors, updateState } = model;
  const setStatusBanner = useAppStore((s) => s.setStatusBanner);

  const [tokenDraft, setTokenDraft] = useState('');
  const [savingToken, setSavingToken] = useState(false);
  const [tokenSaveError, setTokenSaveError] = useState('');
  const [tokenSavedConnectorId, setTokenSavedConnectorId] = useState('');

  const selectedConnectorId = selectedConnector?.id || '';
  const isSystemOwned = selectedConnector?.isSystemOwned || false;
  const isDraft = selectedConnector?.isDraft || false;

  useEffect(() => {
    setTokenDraft('');
    setTokenSaveError('');
  }, [selectedConnectorId]);

  const canSaveToken = useMemo(
    () => Boolean(selectedConnectorId) && tokenDraft.trim().length > 0 && !savingToken,
    [savingToken, tokenDraft, selectedConnectorId],
  );

  const reportError = useCallback((label: string, error: unknown) => {
    setStatusBanner({
      kind: 'error',
      message: formatRuntimeConfigErrorBanner(label, error),
    });
  }, [setStatusBanner]);

  const refreshConnectorsFromSdk = useCallback(async () => {
    const connectors = await sdkListConnectors();
    updateState((prev) => {
      const drafts = prev.connectors.filter((c) => c.isDraft);
      return replaceConnectorsInState(prev, [...connectors, ...drafts]);
    });
  }, [updateState]);

  const onAddConnector = useCallback(async () => {
    const vendor: ApiVendor = 'openrouter';
    const provider = vendorToProvider(vendor);
    const runtimeCatalog = await sdkListProviderCatalog();
    const endpoint = resolveProviderEndpoint(provider, runtimeCatalog)
      || DEFAULT_OPENAI_ENDPOINT_V11;
    const draft = {
      id: randomIdV11('draft'),
      label: `API Connector ${state.connectors.length + 1}`,
      vendor,
      provider,
      endpoint,
      hasCredential: false,
      isSystemOwned: false,
      models: [],
      status: 'idle' as const,
      lastCheckedAt: null,
      lastDetail: '',
      isDraft: true,
    };
    updateState((prev) => addConnectorToState(prev, draft));
  }, [state.connectors.length, updateState]);

  const onRemoveSelectedConnector = useCallback(async () => {
    if (!selectedConnectorId) return;
    if (selectedConnector?.isSystemOwned) return;
    if (selectedConnector?.isDraft) {
      updateState((prev) => removeSelectedConnector(prev, selectedConnectorId));
      return;
    }
    await sdkDeleteConnector(selectedConnectorId);
    await refreshConnectorsFromSdk();
  }, [selectedConnectorId, selectedConnector, updateState, refreshConnectorsFromSdk]);

  const onSelectConnector = useCallback((connectorId: string) => {
    updateState((prev) => ({ ...prev, selectedConnectorId: connectorId }));
  }, [updateState]);

  const onRenameSelectedConnector = useCallback((label: string) => {
    if (selectedConnector?.isSystemOwned) return;
    const previousLabel = String(selectedConnector?.label || '');
    updateState((prev) => updateConnectorField(prev, selectedConnectorId, { label }));
    if (selectedConnectorId && !selectedConnector?.isDraft) {
      void (async () => {
        try { await sdkUpdateConnector({ connectorId: selectedConnectorId, label }); }
        catch (error) {
          updateState((prev) => updateConnectorField(prev, selectedConnectorId, { label: previousLabel }));
          reportError('Update connector failed', error);
        }
      })();
    }
  }, [selectedConnector, selectedConnectorId, updateState, reportError]);

  const onChangeConnectorEndpoint = useCallback((endpoint: string) => {
    if (!selectedConnector || selectedConnector.isSystemOwned) return;
    const previousConnector = selectedConnector;
    updateState((prev) => {
      const currentVendor = prev.connectors.find((c) => c.id === selectedConnectorId)?.vendor;
      const inferredVendor = inferVendorFromEndpoint(endpoint);
      if (inferredVendor && inferredVendor !== currentVendor) {
        return updateConnectorField(prev, selectedConnectorId, {
          vendor: inferredVendor,
          endpoint,
          models: [],
          provider: vendorToProvider(inferredVendor),
        });
      }
      return updateConnectorField(prev, selectedConnectorId, { endpoint });
    });
    if (selectedConnectorId && !selectedConnector?.isDraft) {
      void (async () => {
        try { await sdkUpdateConnector({ connectorId: selectedConnectorId, endpoint }); }
        catch (error) {
          updateState((prev) => updateConnectorField(prev, selectedConnectorId, {
            vendor: previousConnector.vendor,
            endpoint: previousConnector.endpoint,
            models: previousConnector.models,
            provider: previousConnector.provider,
          }));
          reportError('Update connector failed', error);
        }
      })();
    }
  }, [selectedConnector, selectedConnectorId, updateState, reportError]);

  const onChangeConnectorToken = useCallback(async (secret: string) => {
    if (!selectedConnectorId || !selectedConnector) return;
    const normalizedSecret = String(secret || '').trim();
    if (!normalizedSecret) return;

    if (selectedConnector.isDraft) {
      const created = await sdkCreateConnector({
        provider: selectedConnector.provider,
        endpoint: selectedConnector.endpoint,
        label: selectedConnector.label,
        apiKey: normalizedSecret,
      });
      if (!created) throw new Error('create connector returned empty payload');
      updateState((prev) => {
        const withoutDraft = prev.connectors.filter((c) => c.id !== selectedConnectorId);
        return { ...prev, connectors: [...withoutDraft, created], selectedConnectorId: created.id };
      });
      model.onVaultChanged();
      return;
    }

    await sdkUpdateConnector({ connectorId: selectedConnectorId, apiKey: normalizedSecret });
    updateState((prev) => updateConnectorField(prev, selectedConnectorId, { hasCredential: true }));
    model.onVaultChanged();
  }, [selectedConnectorId, selectedConnector, updateState, model]);

  const onChangeConnectorVendor = useCallback(async (vendor: string) => {
    if (!selectedConnector || selectedConnector.isSystemOwned) return;
    const previousConnector = selectedConnector;
    const normalizedVendor = vendor as typeof selectedConnector.vendor;
    const provider = vendorToProvider(normalizedVendor);
    const runtimeCatalog = await sdkListProviderCatalog();
    const endpoint = resolveProviderEndpoint(provider, runtimeCatalog) || DEFAULT_OPENAI_ENDPOINT_V11;
    updateState((prev) => updateConnectorField(prev, selectedConnectorId, {
      vendor: normalizedVendor, endpoint, models: [], provider,
    }));
    if (selectedConnectorId && !selectedConnector.isDraft) {
      try { await sdkUpdateConnector({ connectorId: selectedConnectorId, endpoint }); }
      catch (error) {
        updateState((prev) => updateConnectorField(prev, selectedConnectorId, {
          vendor: previousConnector.vendor,
          endpoint: previousConnector.endpoint,
          models: previousConnector.models,
          provider: previousConnector.provider,
        }));
        throw error;
      }
    }
  }, [selectedConnector, selectedConnectorId, updateState]);

  const saveTokenToVault = async () => {
    if (!selectedConnectorId) return;
    const secret = tokenDraft.trim();
    if (!secret) return;
    setSavingToken(true);
    setTokenSaveError('');
    try {
      await onChangeConnectorToken(secret);
      setTokenDraft('');
      setTokenSavedConnectorId(selectedConnectorId);
    } catch (error) {
      setTokenSaveError(error instanceof Error ? error.message : String(error || 'Save failed'));
    } finally {
      setSavingToken(false);
    }
  };

  return (
    <PageShell>
      {/* Connectors List Section */}
      <section>
        <SectionTitle description="Manage your cloud API connectors">
          Cloud API Connectors
        </SectionTitle>
        <div className="mt-3 rounded-2xl bg-white p-5 shadow-[0_6px_18px_rgba(15,23,42,0.04)] ring-1 ring-black/[0.04]">
          <SettingRow
            icon={<CloudIcon className="h-5 w-5" />}
            title="Available Connectors"
            description="Select a connector to configure"
            action={
              <div className="flex items-center gap-2">
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => { void onAddConnector().catch((e) => reportError('Add connector failed', e)); }}
                  icon={<PlusIcon />}
                >
                  Add
                </Button>
                <button
                  type="button"
                  disabled={model.testingConnector || !selectedConnector}
                  onClick={() => void model.testSelectedConnector()}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <BoltIcon className="text-mint-500" />
                  {model.testingConnector ? 'Testing...' : 'Test'}
                </button>
              </div>
            }
          />

          <div className="mx-5 h-px bg-gray-200/70" />

          {/* Connector Chips */}
          <div className="px-5 py-4">
            {orderedConnectors.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-gray-100">
                  <CloudIcon className="h-6 w-6 text-gray-400" />
                </div>
                <p className="text-sm font-medium text-gray-900">No Connectors</p>
                <p className="text-xs text-gray-500 mt-1">Click "Add" to create your first connector</p>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {orderedConnectors.map((connector) => {
                  const active = connector.id === state.selectedConnectorId;
                  const isHealthy = connector.status === 'healthy';
                  return (
                    <button
                      key={connector.id}
                      type="button"
                      onClick={() => onSelectConnector(connector.id)}
                      className={`rounded-xl border px-4 py-2.5 text-left text-xs transition-all ${
                        active
                          ? 'border-mint-300 bg-mint-50 ring-1 ring-mint-200'
                          : 'border-gray-200 bg-white/90 hover:border-mint-200 hover:bg-mint-50/30'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className={`inline-block h-2 w-2 rounded-full ${
                          isHealthy ? 'bg-green-500' : connector.status === 'unreachable' || connector.status === 'degraded' || connector.status === 'unsupported' ? 'bg-red-500' : 'bg-gray-300'
                        }`} />
                        <p className="font-semibold text-gray-900">{connector.label}</p>
                        {connector.isSystemOwned ? (
                          <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[9px] text-gray-500">system</span>
                        ) : connector.isDraft ? (
                          <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] text-amber-600">draft</span>
                        ) : null}
                      </div>
                      <p className="text-[10px] text-gray-500 mt-0.5">{getVendorLabelV11(connector.vendor)}</p>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Selected Connector Configuration */}
      {selectedConnector ? (
        <section>
          <SectionTitle description="Configure the selected connector">
            Connector Configuration
          </SectionTitle>
          <div className="mt-3 space-y-4 rounded-2xl bg-white p-5 shadow-[0_6px_18px_rgba(15,23,42,0.04)] ring-1 ring-black/[0.04]">
            {/* Name and Vendor */}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Input
                label="Connector Name"
                value={selectedConnector.label}
                onChange={onRenameSelectedConnector}
                placeholder="My API Connector"
                disabled={isSystemOwned}
                icon={<ServerIcon />}
              />
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700">Vendor</label>
                <RuntimeSelect
                  value={selectedConnector.vendor}
                  onChange={(nextVendor) => { void onChangeConnectorVendor(nextVendor).catch((err) => reportError('Switch vendor failed', err)); }}
                  disabled={isSystemOwned}
                  className="w-full"
                  options={VENDOR_ORDER_V11.map((vendor) => ({
                    value: vendor,
                    label: getVendorLabelV11(vendor),
                  }))}
                />
              </div>
            </div>

            {/* Endpoint and API Key */}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Input
                label="Endpoint"
                value={selectedConnector.endpoint}
                onChange={onChangeConnectorEndpoint}
                placeholder={DEFAULT_OPENAI_ENDPOINT_V11}
                disabled={isSystemOwned}
              />
              {isSystemOwned ? (
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-gray-700">API Key</label>
                  <div className="rounded-xl bg-[#F7F9FC] px-4 py-3 ring-1 ring-black/5">
                    <p className="text-xs text-gray-500">
                      {selectedConnector.hasCredential
                        ? 'Managed by runtime (environment variable)'
                        : 'Not configured — set the environment variable in config.json'}
                    </p>
                  </div>
                </div>
              ) : (
                <Input
                  label={isDraft ? 'API Key (required)' : 'Session API Key'}
                  value={tokenDraft}
                  onChange={setTokenDraft}
                  type={model.showCloudApiKey ? 'text' : 'password'}
                  placeholder="sk-..."
                  icon={<KeyIcon />}
                />
              )}
            </div>

            {/* Actions */}
            <div className="flex flex-wrap items-center gap-2 pt-2">
              {!isSystemOwned && (
                <Button
                  variant="primary"
                  size="sm"
                  disabled={!canSaveToken}
                  onClick={() => void saveTokenToVault()}
                  icon={savingToken ? undefined : <CheckIcon />}
                >
                  {savingToken ? 'Saving...' : isDraft ? 'Create Connector' : 'Save API Key'}
                </Button>
              )}
              <Button
                variant="secondary"
                size="sm"
                onClick={() => model.setShowCloudApiKey((v) => !v)}
                icon={model.showCloudApiKey ? <EyeOffIcon /> : <EyeIcon />}
              >
                {model.showCloudApiKey ? 'Hide' : 'Show'}
              </Button>
              {!isSystemOwned && selectedConnectorId && (
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => { void onRemoveSelectedConnector().catch((e) => reportError('Remove connector failed', e)); }}
                  icon={<TrashIcon />}
                >
                  Delete
                </Button>
              )}
              <div className="flex-1" />
              <StatusBadge status={selectedConnector.status} />
            </div>

            {/* Info Messages */}
            <div className="space-y-2">
              <p className="text-xs text-gray-400">ID: {selectedConnector.id}</p>
              {selectedConnector.hasCredential && (
                <p className="flex items-center gap-1.5 text-xs text-green-600">
                  <CheckIcon className="h-3.5 w-3.5" />
                  Credential configured
                </p>
              )}
              {tokenSavedConnectorId === selectedConnector.id && (
                <p className="flex items-center gap-1.5 text-xs text-green-600">
                  <CheckIcon className="h-3.5 w-3.5" />
                  API Key saved successfully
                </p>
              )}
              {tokenSaveError && (
                <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{tokenSaveError}</p>
              )}
            </div>

            <div className="h-px bg-gray-200/70" />

            {/* Models Section */}
            <div className="space-y-3">
              <Input
                label="Search Models"
                value={model.connectorModelQuery}
                onChange={model.setConnectorModelQuery}
                placeholder="Search by model name..."
                icon={<SearchIcon />}
              />
              <div>
                <p className="text-sm font-medium text-gray-700 mb-2">Available Models</p>
                {renderModelChips(model.filteredConnectorModels, `connector-${selectedConnector.id}`)}
              </div>
            </div>
          </div>
        </section>
      ) : (
        <div className="rounded-2xl bg-white p-8 shadow-[0_6px_18px_rgba(15,23,42,0.04)] ring-1 ring-black/[0.04]">
          <div className="flex flex-col items-center justify-center text-center">
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-white/80 ring-1 ring-gray-200">
              <CloudIcon className="h-6 w-6 text-gray-400" />
            </div>
            <p className="text-sm font-medium text-gray-900">No Connector Selected</p>
            <p className="text-xs text-gray-500 mt-1">Select a connector above or create a new one</p>
          </div>
        </div>
      )}
    </PageShell>
  );
}
