import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getPlatformClient } from '@nimiplatform/sdk';
import type { ProviderCatalogEntry } from '@nimiplatform/sdk/runtime';
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
  defaultConnectorAuthOptionForProvider,
  listConnectorAuthOptionsForProvider,
  sdkCreateConnector,
  sdkDeleteConnector,
  sdkUpdateConnector,
  sdkListConnectors,
  sdkListProviderCatalog,
  providerToVendor,
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
import { Card as PrimitiveCard, RuntimeSelect, StatusBadge, renderModelChips } from './runtime-config-primitives';
import { RuntimePageShell } from './runtime-config-page-shell';
import { SectionTitle as SharedSectionTitle } from '@renderer/features/settings/settings-layout-components';
import { E2E_IDS } from '@renderer/testability/e2e-ids';
import { InlineFeedback } from '@renderer/ui/feedback/inline-feedback';
import { acquireCodexManagedCredential, type CodexOAuthPendingState } from './runtime-config-codex-oauth';

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

// Use shared SectionTitle from settings-layout-components (imported as SharedSectionTitle)
const SectionTitle = SharedSectionTitle;


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
    ? 'bg-[var(--nimi-action-primary-bg)] text-white hover:bg-[var(--nimi-action-primary-bg-hover)] disabled:bg-[color-mix(in_srgb,var(--nimi-text-muted)_35%,transparent)]'
    : variant === 'secondary'
      ? 'border border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_24%,transparent)] bg-white text-[var(--nimi-action-primary-bg)] hover:bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_10%,transparent)] disabled:bg-[color-mix(in_srgb,var(--nimi-surface-card)_78%,var(--nimi-surface-panel))] disabled:text-[color-mix(in_srgb,var(--nimi-text-muted)_80%,transparent)]'
      : variant === 'danger'
        ? 'border border-[color-mix(in_srgb,var(--nimi-status-danger)_28%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-danger)_12%,transparent)] text-[var(--nimi-status-danger)] hover:bg-[color-mix(in_srgb,var(--nimi-status-danger)_18%,transparent)] disabled:opacity-50'
        : 'text-[var(--nimi-action-primary-bg)] hover:bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_10%,transparent)] disabled:text-[color-mix(in_srgb,var(--nimi-text-muted)_60%,transparent)]';

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
      {label && <label className="mb-1.5 block text-sm font-medium text-[var(--nimi-text-secondary)]">{label}</label>}
      <div className="relative">
        {icon && (
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-[color-mix(in_srgb,var(--nimi-text-muted)_80%,transparent)]">
            {icon}
          </div>
        )}
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          className={`h-11 w-full rounded-xl border border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_18%,transparent)] bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_8%,var(--nimi-surface-card))] text-sm text-[var(--nimi-text-primary)] outline-none transition-all placeholder:text-[color-mix(in_srgb,var(--nimi-text-muted)_80%,transparent)] focus:border-[var(--nimi-field-focus)] focus:bg-white focus:ring-2 focus:ring-mint-100 disabled:opacity-60 ${icon ? 'pl-10 pr-4' : 'px-4'}`}
        />
      </div>
    </div>
  );
}

export function CloudPage({ model, state }: CloudPageProps) {
  const PROVIDER_CATALOG_ERROR_LABEL = 'Load provider catalog failed';
  const CONNECTORS_LOAD_ERROR_LABEL = 'Load connectors failed';
  const { t } = useTranslation();
  const { selectedConnector, orderedConnectors, updateState } = model;
  const authStatus = useAppStore((s) => s.auth.status);
  const [providerCatalog, setProviderCatalog] = useState<ProviderCatalogEntry[]>([]);
  const pageFeedbackRef = useRef(model.pageFeedback);

  const [tokenDraft, setTokenDraft] = useState('');
  const [savingToken, setSavingToken] = useState(false);
  const [tokenSaveError, setTokenSaveError] = useState('');
  const [tokenSavedConnectorId, setTokenSavedConnectorId] = useState('');
  const [codexOAuthPending, setCodexOAuthPending] = useState<CodexOAuthPendingState | null>(null);
  const [codexOAuthBusy, setCodexOAuthBusy] = useState(false);

  const selectedConnectorId = selectedConnector?.id || '';
  const connectorScope = selectedConnector?.scope || 'user';
  const isRuntimeSystem = connectorScope === 'runtime-system';
  const isMachineGlobal = connectorScope === 'machine-global';
  const isSystemOwned = isRuntimeSystem;
  const isDraft = selectedConnector?.isDraft || false;
  const canEditVendor = !isRuntimeSystem && isDraft;
  const authOptions = useMemo(
    () => listConnectorAuthOptionsForProvider(selectedConnector?.provider || ''),
    [selectedConnector?.provider],
  );
  const selectedAuthOptionValue = useMemo(() => {
    if (!selectedConnector) {
      return 'api_key';
    }
    if (selectedConnector.authMode === 'oauth_managed' && selectedConnector.providerAuthProfile) {
      return `oauth:${selectedConnector.providerAuthProfile}`;
    }
    return 'api_key';
  }, [selectedConnector]);
  const canEditCredentialMode = !isRuntimeSystem && isDraft && authOptions.length > 1;
  const oauthManagedRequiresAuth = selectedConnector?.authMode === 'oauth_managed';
  const isCodexManagedConnector = selectedConnector?.authMode === 'oauth_managed'
    && selectedConnector?.providerAuthProfile === 'openai_codex';
  const canStartCodexOAuth = Boolean(selectedConnectorId)
    && isCodexManagedConnector
    && authStatus === 'authenticated'
    && !savingToken
    && !codexOAuthBusy;

  useEffect(() => {
    pageFeedbackRef.current = model.pageFeedback;
  }, [model.pageFeedback]);

  useEffect(() => {
    setTokenDraft('');
    setTokenSaveError('');
    setCodexOAuthPending(null);
    setCodexOAuthBusy(false);
  }, [selectedConnectorId]);

  const canSaveToken = useMemo(
    () => (
      Boolean(selectedConnectorId)
      && tokenDraft.trim().length > 0
      && !savingToken
      && !codexOAuthBusy
      && (!oauthManagedRequiresAuth || authStatus === 'authenticated')
    ),
    [authStatus, codexOAuthBusy, oauthManagedRequiresAuth, savingToken, tokenDraft, selectedConnectorId],
  );
  const selectedProviderCatalogEntry = useMemo(
    () => providerCatalog.find((entry) => entry.provider === selectedConnector?.provider) || null,
    [providerCatalog, selectedConnector?.provider],
  );

  const reportError = useCallback((label: string, error: unknown) => {
    model.setPageFeedback({
      kind: 'error',
      message: formatRuntimeConfigErrorBanner(label, error),
    });
  }, [model]);

  const clearPageErrorByLabel = useCallback((label: string) => {
    if (
      pageFeedbackRef.current?.kind === 'error'
      && String(pageFeedbackRef.current.message || '').includes(label)
    ) {
      model.setPageFeedback(null);
    }
  }, [model]);

  useEffect(() => {
    model.setConnectorTestFeedback(null);
  }, [model, selectedConnectorId]);

  const loadProviderCatalog = useCallback(async () => {
    const providers = await sdkListProviderCatalog();
    setProviderCatalog(Array.isArray(providers) ? providers : []);
    clearPageErrorByLabel(PROVIDER_CATALOG_ERROR_LABEL);
  }, [clearPageErrorByLabel, PROVIDER_CATALOG_ERROR_LABEL]);

  const vendorOptions = useMemo(() => {
    const known = [...VENDOR_ORDER_V11];
    const knownSet = new Set(known);
    const dynamicProviders = providerCatalog
      .filter((entry) => entry.managedSupported && entry.provider !== 'local')
      .map((entry) => providerToVendor(entry.provider))
      .filter((vendor) => Boolean(vendor) && !knownSet.has(vendor));
    const orderedDynamicProviders = Array.from(new Set(dynamicProviders))
      .sort((left, right) => getVendorLabelV11(left).localeCompare(getVendorLabelV11(right)));
    return [...known, ...orderedDynamicProviders].map((vendor) => ({
      value: vendor,
      label: getVendorLabelV11(vendor),
    }));
  }, [providerCatalog]);

  const refreshConnectorsFromSdk = useCallback(async () => {
    const connectors = await sdkListConnectors();
    updateState((prev) => {
      const drafts = prev.connectors.filter((c) => c.isDraft);
      return replaceConnectorsInState(prev, [...connectors, ...drafts]);
    });
    clearPageErrorByLabel(CONNECTORS_LOAD_ERROR_LABEL);
  }, [clearPageErrorByLabel, updateState, CONNECTORS_LOAD_ERROR_LABEL]);

  useEffect(() => {
    let cancelled = false;
    void loadProviderCatalog()
      .catch((error) => {
        if (!cancelled) {
          reportError(PROVIDER_CATALOG_ERROR_LABEL, error);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [loadProviderCatalog, reportError, PROVIDER_CATALOG_ERROR_LABEL]);

  useEffect(() => {
    const unsubscribe = getPlatformClient().runtime.events.on('runtime.connected', () => {
      void loadProviderCatalog()
        .catch((error) => {
          reportError(PROVIDER_CATALOG_ERROR_LABEL, error);
        });
      void refreshConnectorsFromSdk()
        .catch((error) => {
          reportError(CONNECTORS_LOAD_ERROR_LABEL, error);
        });
    });
    return unsubscribe;
  }, [
    loadProviderCatalog,
    refreshConnectorsFromSdk,
    reportError,
    PROVIDER_CATALOG_ERROR_LABEL,
    CONNECTORS_LOAD_ERROR_LABEL,
  ]);

  const onAddConnector = useCallback(async () => {
    const vendor: ApiVendor = 'openrouter';
    const provider = vendorToProvider(vendor);
    const defaultAuthOption = defaultConnectorAuthOptionForProvider(provider);
    const runtimeCatalog = await sdkListProviderCatalog();
    const endpoint = resolveProviderEndpoint(provider, runtimeCatalog)
      || DEFAULT_OPENAI_ENDPOINT_V11;
    const draft = {
      id: randomIdV11('draft'),
      label: `API Connector ${state.connectors.length + 1}`,
      vendor,
      provider,
      authMode: defaultAuthOption.authMode,
      providerAuthProfile: defaultAuthOption.providerAuthProfile,
      endpoint,
      scope: authStatus === 'authenticated' ? 'user' as const : 'machine-global' as const,
      hasCredential: false,
      isSystemOwned: false,
      models: [],
      status: 'idle' as const,
      lastCheckedAt: null,
      lastDetail: '',
      isDraft: true,
    };
    updateState((prev) => addConnectorToState(prev, draft));
  }, [authStatus, state.connectors.length, updateState]);

  const onRemoveSelectedConnector = useCallback(async () => {
    if (!selectedConnectorId) return;
    if (isRuntimeSystem) return;
    if (selectedConnector?.isDraft) {
      updateState((prev) => removeSelectedConnector(prev, selectedConnectorId));
      return;
    }
    await sdkDeleteConnector(selectedConnectorId);
    await refreshConnectorsFromSdk();
  }, [isRuntimeSystem, selectedConnectorId, selectedConnector, updateState, refreshConnectorsFromSdk]);

  const onSelectConnector = useCallback((connectorId: string) => {
    updateState((prev) => ({ ...prev, selectedConnectorId: connectorId }));
  }, [updateState]);

  const onRenameSelectedConnector = useCallback((label: string) => {
    if (isRuntimeSystem) return;
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
  }, [isRuntimeSystem, selectedConnector, selectedConnectorId, updateState, reportError]);

  const onChangeConnectorEndpoint = useCallback((endpoint: string) => {
    if (!selectedConnector || isRuntimeSystem) return;
    const previousConnector = selectedConnector;
    updateState((prev) => {
      const currentVendor = prev.connectors.find((c) => c.id === selectedConnectorId)?.vendor;
      const inferredVendor = inferVendorFromEndpoint(endpoint);
      if (inferredVendor && inferredVendor !== currentVendor) {
        const inferredProvider = vendorToProvider(inferredVendor);
        const defaultAuthOption = defaultConnectorAuthOptionForProvider(inferredProvider);
        return updateConnectorField(prev, selectedConnectorId, {
          vendor: inferredVendor,
          endpoint,
          models: [],
          provider: inferredProvider,
          authMode: defaultAuthOption.authMode,
          providerAuthProfile: defaultAuthOption.providerAuthProfile,
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
  }, [isRuntimeSystem, selectedConnector, selectedConnectorId, updateState, reportError]);

  const onSaveConnectorCredential = useCallback(async (input: {
    credentialValue?: string;
    credentialJson?: string;
  }) => {
    if (!selectedConnectorId || !selectedConnector) return '';
    const normalizedSecret = String(input.credentialValue || '').trim();
    const normalizedCredentialJson = String(input.credentialJson || '').trim();
    if (!normalizedSecret && !normalizedCredentialJson) return '';
    if (selectedConnector.authMode === 'oauth_managed' && authStatus !== 'authenticated') {
      throw new Error('Managed OAuth connectors require an authenticated desktop session.');
    }

    if (selectedConnector.isDraft) {
      const created = await sdkCreateConnector({
        provider: selectedConnector.provider,
        endpoint: selectedConnector.endpoint,
        label: selectedConnector.label,
        credentialValue: normalizedSecret,
        credentialJson: normalizedCredentialJson,
        authMode: selectedConnector.authMode,
        providerAuthProfile: selectedConnector.providerAuthProfile,
      });
      if (!created) throw new Error('create connector returned empty payload');
      updateState((prev) => {
        const withoutDraft = prev.connectors.filter((c) => c.id !== selectedConnectorId);
        return { ...prev, connectors: [...withoutDraft, created], selectedConnectorId: created.id };
      });
      model.onVaultChanged();
      return created.id;
    }

    await sdkUpdateConnector({
      connectorId: selectedConnectorId,
      credentialValue: normalizedSecret,
      credentialJson: normalizedCredentialJson,
      authMode: selectedConnector.authMode,
      providerAuthProfile: selectedConnector.providerAuthProfile,
    });
    updateState((prev) => updateConnectorField(prev, selectedConnectorId, { hasCredential: true }));
    model.onVaultChanged();
    return selectedConnectorId;
  }, [authStatus, selectedConnectorId, selectedConnector, updateState, model]);

  const onAcquireCodexOAuth = useCallback(async () => {
    if (!selectedConnector || !selectedConnectorId || !isCodexManagedConnector) {
      return;
    }
    setCodexOAuthBusy(true);
    setTokenSaveError('');
    setTokenSavedConnectorId('');
    try {
      const acquired = await acquireCodexManagedCredential({
        onPending: (pending) => {
          setCodexOAuthPending(pending);
        },
      });
      const persistedConnectorId = await onSaveConnectorCredential({
        credentialValue: acquired.accessToken,
        credentialJson: acquired.credentialJson,
      });
      setTokenDraft('');
      setCodexOAuthPending(null);
      setTokenSavedConnectorId(persistedConnectorId || selectedConnectorId);
    } catch (error) {
      setTokenSaveError(error instanceof Error ? error.message : String(error || 'Codex sign-in failed'));
    } finally {
      setCodexOAuthBusy(false);
    }
  }, [isCodexManagedConnector, onSaveConnectorCredential, selectedConnector, selectedConnectorId]);

  const onChangeConnectorVendor = useCallback(async (vendor: string) => {
    if (!selectedConnector || !canEditVendor) return;
    const previousConnector = selectedConnector;
    const normalizedVendor = vendor as typeof selectedConnector.vendor;
    const provider = vendorToProvider(normalizedVendor);
    const defaultAuthOption = defaultConnectorAuthOptionForProvider(provider);
    const runtimeCatalog = await sdkListProviderCatalog();
    const endpoint = resolveProviderEndpoint(provider, runtimeCatalog) || DEFAULT_OPENAI_ENDPOINT_V11;
    updateState((prev) => updateConnectorField(prev, selectedConnectorId, {
      vendor: normalizedVendor,
      endpoint,
      models: [],
      provider,
      authMode: defaultAuthOption.authMode,
      providerAuthProfile: defaultAuthOption.providerAuthProfile,
    }));
    if (selectedConnectorId && !selectedConnector.isDraft) {
      try { await sdkUpdateConnector({ connectorId: selectedConnectorId, endpoint }); }
      catch (error) {
        updateState((prev) => updateConnectorField(prev, selectedConnectorId, {
          vendor: previousConnector.vendor,
          endpoint: previousConnector.endpoint,
          models: previousConnector.models,
          provider: previousConnector.provider,
          authMode: previousConnector.authMode,
          providerAuthProfile: previousConnector.providerAuthProfile,
        }));
        throw error;
      }
    }
  }, [canEditVendor, selectedConnector, selectedConnectorId, updateState]);

  const onChangeConnectorAuthOption = useCallback((nextValue: string) => {
    if (!selectedConnector || isRuntimeSystem || !isDraft) return;
    const nextOption = authOptions.find((option) => option.value === nextValue) || null;
    if (!nextOption) return;
    updateState((prev) => updateConnectorField(prev, selectedConnectorId, {
      authMode: nextOption.authMode,
      providerAuthProfile: nextOption.providerAuthProfile,
      hasCredential: false,
    }));
    setTokenDraft('');
    setTokenSaveError('');
    setTokenSavedConnectorId('');
  }, [authOptions, isDraft, isRuntimeSystem, selectedConnector, selectedConnectorId, updateState]);

  const saveTokenToVault = async () => {
    if (!selectedConnectorId) return;
    const secret = tokenDraft.trim();
    if (!secret) return;
    setSavingToken(true);
    setTokenSaveError('');
    try {
      const persistedConnectorId = await onSaveConnectorCredential({ credentialValue: secret });
      setTokenDraft('');
      setTokenSavedConnectorId(persistedConnectorId || selectedConnectorId);
    } catch (error) {
      setTokenSaveError(error instanceof Error ? error.message : String(error || 'Save failed'));
    } finally {
      setSavingToken(false);
    }
  };

  return (
    <RuntimePageShell className="space-y-4">
      {/* Top bar: actions */}
      <div className="flex items-center justify-between gap-3">
        <SectionTitle>
          {t('runtimeConfig.cloud.connectors')}
        </SectionTitle>
        <div className="flex items-center gap-2">
          <Button
            variant="primary"
            size="sm"
            onClick={() => { void onAddConnector().catch((e) => reportError('Add connector failed', e)); }}
            icon={<PlusIcon />}
          >
            {t('runtimeConfig.cloud.addConnector', { defaultValue: 'Add' })}
          </Button>
          <button
            type="button"
            disabled={model.testingConnector || !selectedConnector}
            onClick={() => void model.testSelectedConnector()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-sm font-medium text-[var(--nimi-text-secondary)] shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-[color-mix(in_srgb,var(--nimi-surface-card)_90%,var(--nimi-surface-panel))] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <BoltIcon className="text-[var(--nimi-action-primary-bg)]" />
            {model.testingConnector
              ? t('runtimeConfig.cloud.testing', { defaultValue: 'Testing...' })
              : t('runtimeConfig.cloud.testConnector', { defaultValue: 'Test' })}
          </button>
        </div>
      </div>

      {model.connectorTestFeedback ? (
        <InlineFeedback
          feedback={model.connectorTestFeedback}
          className="w-full"
          title={t('runtimeConfig.cloud.testResult', { defaultValue: 'Connector test' })}
          onDismiss={() => model.setConnectorTestFeedback(null)}
        />
      ) : null}

      {/* Split panel: connector list (left) + config (right) */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        {/* Left panel — connector list */}
        <PrimitiveCard className="h-[600px] overflow-y-auto p-4">
          {orderedConnectors.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--nimi-surface-card)_78%,var(--nimi-surface-panel))]">
                <CloudIcon className="h-6 w-6 text-[color-mix(in_srgb,var(--nimi-text-muted)_80%,transparent)]" />
              </div>
              <p className="text-sm font-medium text-[var(--nimi-text-primary)]">{t('runtimeConfig.cloud.noConnectors', { defaultValue: 'No Connectors' })}</p>
              <p className="text-xs text-[var(--nimi-text-muted)] mt-1">
                {t('runtimeConfig.cloud.noConnectorsHint', { defaultValue: 'Click "Add" to create your first connector' })}
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {orderedConnectors.map((connector) => {
                const active = connector.id === state.selectedConnectorId;
                const isHealthy = connector.status === 'healthy';
                return (
                  <button
                    key={connector.id}
                    type="button"
                    onClick={() => onSelectConnector(connector.id)}
                    className={`w-full rounded-xl border px-4 py-3 text-left text-xs transition-all ${
                      active
                        ? 'border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_32%,transparent)] bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_10%,transparent)] ring-1 ring-mint-200'
                        : 'border-[var(--nimi-border-subtle)] bg-white/90 hover:border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_24%,transparent)] hover:bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_10%,transparent)]/30'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${
                        isHealthy ? 'bg-[var(--nimi-status-success)]' : connector.status === 'unreachable' || connector.status === 'degraded' || connector.status === 'unsupported' ? 'bg-[var(--nimi-status-danger)]' : 'bg-[color-mix(in_srgb,var(--nimi-text-muted)_35%,transparent)]'
                      }`} />
                      <p className="truncate font-semibold text-[var(--nimi-text-primary)]">{connector.label}</p>
                      {connector.scope === 'runtime-system' ? (
                        <span
                          data-testid={E2E_IDS.runtimeConnectorScopeBadge(connector.id)}
                          className="shrink-0 rounded-full bg-[color-mix(in_srgb,var(--nimi-surface-card)_78%,var(--nimi-surface-panel))] px-1.5 py-0.5 text-[9px] text-[var(--nimi-text-muted)]"
                        >
                          {t('runtimeConfig.cloud.runtimeSystem', { defaultValue: 'runtime managed' })}
                        </span>
                      ) : connector.scope === 'machine-global' ? (
                        <span
                          data-testid={E2E_IDS.runtimeConnectorScopeBadge(connector.id)}
                          className="shrink-0 rounded-full bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_12%,transparent)] px-1.5 py-0.5 text-[9px] text-[var(--nimi-action-primary-bg)]"
                        >
                          {t('runtimeConfig.cloud.machineGlobal', { defaultValue: 'machine global' })}
                        </span>
                      ) : connector.isDraft ? (
                        <span className="shrink-0 rounded-full bg-[color-mix(in_srgb,var(--nimi-status-warning)_18%,transparent)] px-1.5 py-0.5 text-[9px] text-[var(--nimi-status-warning)]">
                          {t('runtimeConfig.cloud.draft', { defaultValue: 'draft' })}
                        </span>
                      ) : null}
                    </div>
                    <p className="text-[10px] text-[var(--nimi-text-muted)] mt-0.5">{getVendorLabelV11(connector.vendor)}</p>
                  </button>
                );
              })}
            </div>
          )}
        </PrimitiveCard>

        {/* Right panel — connector config */}
        <PrimitiveCard className="h-[600px] overflow-y-auto p-5">
          {selectedConnector ? (
            <div className="space-y-4">
              {/* Name and Vendor */}
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Input
                  label={t('runtimeConfig.cloud.connectorName', { defaultValue: 'Connector Name' })}
                  value={selectedConnector.label}
                  onChange={onRenameSelectedConnector}
                  placeholder={t('runtimeConfig.cloud.connectorNamePlaceholder', { defaultValue: 'My API Connector' })}
                  disabled={isRuntimeSystem}
                  icon={<ServerIcon />}
                />
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-[var(--nimi-text-secondary)]">
                    {t('runtimeConfig.cloud.vendor', { defaultValue: 'Vendor' })}
                  </label>
                  <RuntimeSelect
                    value={selectedConnector.vendor}
                    onChange={(nextVendor) => { void onChangeConnectorVendor(nextVendor).catch((err) => reportError('Switch vendor failed', err)); }}
                    disabled={!canEditVendor}
                    className="w-full"
                    options={vendorOptions}
                  />
                  {!canEditVendor ? (
                    <p className="mt-1 text-xs text-[var(--nimi-text-muted)]">
                      {t('runtimeConfig.cloud.vendorImmutableAfterCreate', {
                        defaultValue: 'Vendor is fixed after connector creation. Create a new connector to switch provider.',
                      })}
                    </p>
                  ) : null}
                </div>
              </div>

              {/* Endpoint and Credential */}
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Input
                  label={t('runtimeConfig.cloud.endpoint', { defaultValue: 'Endpoint' })}
                  value={selectedConnector.endpoint}
                  onChange={onChangeConnectorEndpoint}
                  placeholder={DEFAULT_OPENAI_ENDPOINT_V11}
                  disabled={isRuntimeSystem}
                />
                {isRuntimeSystem ? (
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-[var(--nimi-text-secondary)]">
                      {t('runtimeConfig.cloud.apiKey', { defaultValue: 'API Key' })}
                    </label>
                    <div className="rounded-xl bg-[color-mix(in_srgb,var(--nimi-surface-card)_90%,var(--nimi-surface-panel))] px-4 py-3 ring-1 ring-black/5">
                      <p className="text-xs text-[var(--nimi-text-muted)]">
                        {selectedConnector.hasCredential
                          ? t('runtimeConfig.cloud.managedByRuntime', { defaultValue: 'Managed by runtime (environment variable)' })
                          : t('runtimeConfig.cloud.notConfigured', { defaultValue: 'Not configured — set the environment variable in config.json' })}
                      </p>
                    </div>
                  </div>
                ) : (
                  <Input
                    label={selectedConnector.authMode === 'oauth_managed'
                      ? t('runtimeConfig.cloud.oauthTokenRequired', { defaultValue: 'Managed OAuth Token (required)' })
                      : isDraft
                        ? t('runtimeConfig.cloud.apiKeyRequired', { defaultValue: 'API Key (required)' })
                        : t('runtimeConfig.cloud.sessionApiKey', { defaultValue: 'Session API Key' })}
                    value={tokenDraft}
                    onChange={setTokenDraft}
                    type={model.showCloudApiKey ? 'text' : 'password'}
                    placeholder={selectedConnector.authMode === 'oauth_managed' ? 'access token' : 'sk-...'}
                    icon={<KeyIcon />}
                  />
                )}
              </div>
              {!isRuntimeSystem ? (
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-[var(--nimi-text-secondary)]">
                    {t('runtimeConfig.cloud.credentialType', { defaultValue: 'Credential Type' })}
                  </label>
                  <RuntimeSelect
                    value={selectedAuthOptionValue}
                    onChange={onChangeConnectorAuthOption}
                    disabled={!canEditCredentialMode}
                    className="w-full"
                    options={authOptions}
                  />
                  {!canEditCredentialMode ? (
                    <p className="mt-1 text-xs text-[var(--nimi-text-muted)]">
                      {isDraft
                        ? t('runtimeConfig.cloud.credentialTypeFixedForProvider', {
                          defaultValue: 'This provider exposes a single admitted credential shape in the current runtime profile.',
                        })
                        : t('runtimeConfig.cloud.credentialTypeImmutableAfterCreate', {
                          defaultValue: 'Credential type is fixed after connector creation. Create a new connector to switch auth shape.',
                        })}
                    </p>
                  ) : null}
                </div>
              ) : null}
              {selectedProviderCatalogEntry?.inventoryMode === 'dynamic_endpoint' ? (
                <div className="rounded-xl border border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_20%,transparent)] bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_10%,transparent)] px-4 py-3">
                  <p className="text-sm font-medium text-[var(--nimi-text-primary)]">
                    {t('runtimeConfig.cloud.liveInventoryTitle', { defaultValue: 'Live inventory provider' })}
                  </p>
                  <p className="mt-1 text-xs text-[var(--nimi-text-muted)]">
                    {t('runtimeConfig.cloud.liveInventoryHint', {
                      defaultValue: 'This provider loads models from the connector endpoint at runtime. Configure an explicit default model or choose a live model in route/chat settings.',
                    })}
                  </p>
                </div>
              ) : null}

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
                    {savingToken
                      ? t('runtimeConfig.cloud.saving', { defaultValue: 'Saving...' })
                      : isDraft
                        ? t('runtimeConfig.cloud.createConnector', { defaultValue: 'Create Connector' })
                        : selectedConnector.authMode === 'oauth_managed'
                          ? t('runtimeConfig.cloud.saveManagedToken', { defaultValue: 'Save Token' })
                          : t('runtimeConfig.cloud.saveApiKey', { defaultValue: 'Save API Key' })}
                  </Button>
                )}
                {isCodexManagedConnector ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={!canStartCodexOAuth}
                    onClick={() => { void onAcquireCodexOAuth(); }}
                  >
                    {codexOAuthBusy
                      ? t('runtimeConfig.cloud.codexOauthSigningIn', { defaultValue: 'Waiting for Codex...' })
                      : t('runtimeConfig.cloud.codexOauthStart', { defaultValue: 'Sign in with Codex' })}
                  </Button>
                ) : null}
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => model.setShowCloudApiKey((v) => !v)}
                  icon={model.showCloudApiKey ? <EyeOffIcon /> : <EyeIcon />}
                >
                  {model.showCloudApiKey
                    ? t('Auth.hidePassword', { defaultValue: 'Hide' })
                    : t('Auth.showPassword', { defaultValue: 'Show' })}
                </Button>
                {!isSystemOwned && selectedConnectorId && (
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => { void onRemoveSelectedConnector().catch((e) => reportError('Remove connector failed', e)); }}
                    icon={<TrashIcon />}
                  >
                    {t('runtimeConfig.cloud.deleteConnector', { defaultValue: 'Delete' })}
                  </Button>
                )}
                <div className="flex-1" />
                <StatusBadge status={selectedConnector.status} />
              </div>

              {/* Info Messages */}
              <div className="space-y-2">
                <p className="text-xs text-[color-mix(in_srgb,var(--nimi-text-muted)_80%,transparent)]">ID: {selectedConnector.id}</p>
                {isMachineGlobal ? (
                  <p className="text-xs text-[var(--nimi-action-primary-bg)]">
                    {t('runtimeConfig.cloud.managedMachineGlobal', { defaultValue: 'Shared across accounts on this machine' })}
                  </p>
                ) : null}
                {selectedConnector.hasCredential && (
                  <p className="flex items-center gap-1.5 text-xs text-[var(--nimi-status-success)]">
                    <CheckIcon className="h-3.5 w-3.5" />
                    {t('runtimeConfig.cloud.credentialConfigured', { defaultValue: 'Credential configured' })}
                  </p>
                )}
                {selectedConnector.authMode === 'oauth_managed' && authStatus !== 'authenticated' ? (
                  <p className="text-xs text-[var(--nimi-status-warning)] bg-[color-mix(in_srgb,var(--nimi-status-warning)_12%,transparent)] rounded-lg px-3 py-2">
                    {t('runtimeConfig.cloud.oauthRequiresAuth', {
                      defaultValue: 'Managed OAuth connectors require an authenticated desktop session before they can be created.',
                    })}
                  </p>
                ) : null}
                {isCodexManagedConnector && codexOAuthPending ? (
                  <div className="rounded-lg bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_10%,transparent)] px-3 py-2 text-xs text-[var(--nimi-text-secondary)]">
                    <p className="font-medium text-[var(--nimi-text-primary)]">
                      {t('runtimeConfig.cloud.codexOauthPendingTitle', { defaultValue: 'Complete Codex sign-in' })}
                    </p>
                    <p className="mt-1">
                      {t('runtimeConfig.cloud.codexOauthPendingBody', {
                        defaultValue: 'The browser was opened for Codex sign-in. Enter the code below if prompted, then return here.',
                      })}
                    </p>
                    <p className="mt-2 font-mono text-sm tracking-[0.2em] text-[var(--nimi-action-primary-bg)]">
                      {codexOAuthPending.userCode}
                    </p>
                    <p className="mt-2 break-all">
                      <a
                        href={codexOAuthPending.verificationUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[var(--nimi-action-primary-bg)] underline"
                      >
                        {codexOAuthPending.verificationUrl}
                      </a>
                    </p>
                  </div>
                ) : null}
                {tokenSavedConnectorId === selectedConnector.id && (
                  <p className="flex items-center gap-1.5 text-xs text-[var(--nimi-status-success)]">
                    <CheckIcon className="h-3.5 w-3.5" />
                    {selectedConnector.authMode === 'oauth_managed'
                      ? t('runtimeConfig.cloud.managedCredentialSaved', { defaultValue: 'Managed credential saved successfully' })
                      : t('runtimeConfig.cloud.apiKeySaved', { defaultValue: 'API Key saved successfully' })}
                  </p>
                )}
                {tokenSaveError && (
                  <p className="text-xs text-[var(--nimi-status-danger)] bg-[color-mix(in_srgb,var(--nimi-status-danger)_12%,transparent)] rounded-lg px-3 py-2">{tokenSaveError}</p>
                )}
              </div>

              <div className="h-px bg-[color-mix(in_srgb,var(--nimi-border-subtle)_70%,transparent)]" />

              {/* Models Section */}
              <div className="space-y-3">
                <Input
                  label={t('runtimeConfig.cloud.searchModels', { defaultValue: 'Search Models' })}
                  value={model.connectorModelQuery}
                  onChange={model.setConnectorModelQuery}
                  placeholder={t('runtimeConfig.cloud.searchModelsPlaceholder', { defaultValue: 'Search by model name...' })}
                  icon={<SearchIcon />}
                />
                <div>
                  <p className="text-sm font-medium text-[var(--nimi-text-secondary)] mb-2">
                    {t('runtimeConfig.cloud.availableModels', { defaultValue: 'Available Models' })}
                  </p>
                  {renderModelChips(model.filteredConnectorModels, `connector-${selectedConnector.id}`)}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-white/80 ring-1 ring-gray-200">
                <CloudIcon className="h-6 w-6 text-[color-mix(in_srgb,var(--nimi-text-muted)_80%,transparent)]" />
              </div>
              <p className="text-sm font-medium text-[var(--nimi-text-primary)]">
                {t('runtimeConfig.cloud.noConnectorSelected', { defaultValue: 'No Connector Selected' })}
              </p>
              <p className="text-xs text-[var(--nimi-text-muted)] mt-1">
                {t('runtimeConfig.cloud.noConnectorSelectedHint', { defaultValue: 'Select a connector above or create a new one' })}
              </p>
            </div>
          )}
        </PrimitiveCard>
      </div>
    </RuntimePageShell>
  );
}
