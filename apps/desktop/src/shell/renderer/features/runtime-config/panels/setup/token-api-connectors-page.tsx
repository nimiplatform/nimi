import { useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_OPENAI_ENDPOINT_V11,
  VENDOR_CATALOGS_V11,
  VENDOR_ORDER_V11,
  type RuntimeConfigStateV11,
} from '@renderer/features/runtime-config/state/v11/types';
import { Button, Card, Input, StatusBadge, renderModelChips } from '../primitives';

type TokenApiConnectorsPageProps = {
  state: RuntimeConfigStateV11;
  selectedConnector: RuntimeConfigStateV11['connectors'][number] | null;
  orderedConnectors: RuntimeConfigStateV11['connectors'];
  showTokenApiKey: boolean;
  connectorModelQuery: string;
  filteredConnectorModels: string[];
  testingConnector: boolean;
  onSetShowTokenApiKey: (next: boolean | ((prev: boolean) => boolean)) => void;
  onSetConnectorModelQuery: (value: string) => void;
  onAddConnector: () => void;
  onRemoveSelectedConnector: () => void;
  onSelectConnector: (connectorId: string) => void;
  onRenameSelectedConnector: (label: string) => void;
  onChangeConnectorEndpoint: (endpoint: string) => void;
  onChangeConnectorToken: (secret: string) => Promise<void>;
  onChangeConnectorTokenEnv: (tokenApiKeyEnv: string) => void;
  onChangeConnectorVendor: (vendor: string) => void;
  onTestSelectedConnector: () => Promise<void>;
};

export function TokenApiConnectorsPage({
  state,
  selectedConnector,
  orderedConnectors,
  showTokenApiKey,
  connectorModelQuery,
  filteredConnectorModels,
  testingConnector,
  onSetShowTokenApiKey,
  onSetConnectorModelQuery,
  onAddConnector,
  onRemoveSelectedConnector,
  onSelectConnector,
  onRenameSelectedConnector,
  onChangeConnectorEndpoint,
  onChangeConnectorToken,
  onChangeConnectorTokenEnv,
  onChangeConnectorVendor,
  onTestSelectedConnector,
}: TokenApiConnectorsPageProps) {
  const [tokenDraft, setTokenDraft] = useState('');
  const [savingToken, setSavingToken] = useState(false);
  const [tokenSaveError, setTokenSaveError] = useState('');
  const [tokenSavedConnectorId, setTokenSavedConnectorId] = useState('');

  const selectedConnectorId = selectedConnector?.id || '';
  const canSaveToken = useMemo(
    () => Boolean(selectedConnectorId) && tokenDraft.trim().length > 0 && !savingToken,
    [savingToken, tokenDraft, selectedConnectorId],
  );

  useEffect(() => {
    setTokenDraft('');
    setTokenSaveError('');
  }, [selectedConnectorId]);

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
      setTokenSaveError(error instanceof Error ? error.message : String(error || '保存失败'));
    } finally {
      setSavingToken(false);
    }
  };

  return (
    <Card className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-gray-900">Cloud API Connectors</p>
          <p className="text-xs text-gray-500">Configure API keys for cloud-based AI providers. Used as fallback when local runtime is unavailable.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={onAddConnector}>Add Connector</Button>
          <Button variant="ghost" size="sm" onClick={onRemoveSelectedConnector}>Delete Connector</Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={testingConnector || !selectedConnector}
            onClick={() => void onTestSelectedConnector()}
          >
            {testingConnector ? 'Testing...' : 'Test'}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {orderedConnectors.map((connector) => {
          const active = connector.id === state.selectedConnectorId;
          return (
            <button
              key={connector.id}
              type="button"
              onClick={() => onSelectConnector(connector.id)}
              className={`rounded-[10px] border px-3 py-2 text-left text-xs transition-colors ${
                active
                  ? 'border-brand-500 bg-brand-50 text-brand-700'
                  : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              <div className="flex items-center gap-1.5">
                <span className={`inline-block h-2 w-2 rounded-full ${
                  connector.status === 'healthy' ? 'bg-emerald-500' : 'bg-gray-300'
                }`} />
                <p className="font-semibold">{connector.label}</p>
              </div>
              <p className="text-[10px] text-gray-500">{VENDOR_CATALOGS_V11[connector.vendor].label}</p>
            </button>
          );
        })}
      </div>

      {selectedConnector ? (
        <div className="space-y-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Connector Configuration</p>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Input
              label="Connector Name (optional)"
              value={selectedConnector.label}
              onChange={onRenameSelectedConnector}
            />

            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">Vendor</label>
              <select
                value={selectedConnector.vendor}
                onChange={(e) => onChangeConnectorVendor(e.target.value)}
                className="h-[46px] w-full rounded-[10px] border border-gray-200 bg-white px-3 text-sm text-gray-900 outline-none transition-colors focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
              >
                {VENDOR_ORDER_V11.map((vendor) => (
                  <option key={vendor} value={vendor}>{VENDOR_CATALOGS_V11[vendor].label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <Input
              label="Endpoint"
              value={selectedConnector.endpoint}
              onChange={onChangeConnectorEndpoint}
              placeholder={DEFAULT_OPENAI_ENDPOINT_V11}
            />

            <Input
              label="Session API Key"
              value={tokenDraft}
              onChange={setTokenDraft}
              type={showTokenApiKey ? 'text' : 'password'}
              placeholder="sk-..."
            />

            <Input
              label="API Key Env"
              value={selectedConnector.tokenApiKeyEnv}
              onChange={onChangeConnectorTokenEnv}
              placeholder="GEMINI_API_KEY"
            />
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="primary"
              size="sm"
              disabled={!canSaveToken}
              onClick={() => void saveTokenToVault()}
            >
              {savingToken ? 'Saving...' : 'Save API Key'}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => onSetShowTokenApiKey((value) => !value)}>
              {showTokenApiKey ? 'Hide API Key' : 'Show API Key'}
            </Button>
            <StatusBadge status={selectedConnector.status} />
          </div>
          <p className="text-xs text-gray-500">Credential Ref: {selectedConnector.id}</p>
          {tokenSavedConnectorId === selectedConnector.id ? (
            <p className="text-xs text-emerald-600">API Key saved in vault.</p>
          ) : null}
          {tokenSaveError ? (
            <p className="text-xs text-rose-600">Save failed: {tokenSaveError}</p>
          ) : null}

          <Input
            label="Search Models"
            value={connectorModelQuery}
            onChange={onSetConnectorModelQuery}
            placeholder="Search by model name..."
          />

          <div>
            <p className="text-sm font-medium text-gray-700">Connector Models</p>
            {renderModelChips(filteredConnectorModels, `connector-${selectedConnector.id}`)}
          </div>
        </div>
      ) : null}
    </Card>
  );
}
