import { useEffect, useState } from 'react';
import {
  getExternalAgentGatewayStatus,
  issueExternalAgentToken,
  listExternalAgentTokens,
  revokeExternalAgentToken,
  type ExternalAgentTokenRecord,
} from '@runtime/external-agent';
import { Button, Card, Input, RuntimeSelect } from './runtime-config-primitives';

type TokenMode = 'delegated' | 'autonomous';

export function ExternalAgentAccessPanel() {
  const [statusText, setStatusText] = useState('Loading...');
  const [principalId, setPrincipalId] = useState('openclaw.local');
  const [subjectAccountId, setSubjectAccountId] = useState('');
  const [mode, setMode] = useState<TokenMode>('delegated');
  const [actionsInput, setActionsInput] = useState('runtime.local-ai.models.list');
  const [ttlSeconds, setTtlSeconds] = useState('3600');
  const [tokenId, setTokenId] = useState('');
  const [issuedToken, setIssuedToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [tokens, setTokens] = useState<ExternalAgentTokenRecord[]>([]);

  const refreshGateway = async () => {
    try {
      const status = await getExternalAgentGatewayStatus();
      const rows = await listExternalAgentTokens();
      setStatusText(
        status.enabled
          ? `Enabled @ ${status.bindAddress} · issuer=${status.issuer} · actions=${status.actionCount}`
          : 'Disabled',
      );
      setTokens(rows);
    } catch (error) {
      setStatusText('Gateway unavailable');
      setTokens([]);
      setErrorMessage(error instanceof Error ? error.message : String(error || 'Gateway refresh failed'));
    }
  };

  useEffect(() => {
    void refreshGateway();
  }, []);

  const handleIssueToken = () => {
    void (async () => {
      setBusy(true);
      setErrorMessage('');
      try {
        const ttlRaw = Number(ttlSeconds);
        const actions = actionsInput
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean);
        const issued = await issueExternalAgentToken({
          principalId,
          mode,
          subjectAccountId,
          actions,
          ttlSeconds: Number.isFinite(ttlRaw) && ttlRaw > 0 ? ttlRaw : 3600,
        });
        setIssuedToken(issued.token);
        setTokenId(issued.tokenId);
        await refreshGateway();
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : String(error || 'Issue token failed'));
      } finally {
        setBusy(false);
      }
    })();
  };

  const handleRevokeToken = (targetTokenId?: string) => {
    void (async () => {
      const resolvedTokenId = String(targetTokenId || tokenId).trim();
      if (!resolvedTokenId) return;
      setBusy(true);
      setErrorMessage('');
      try {
        await revokeExternalAgentToken(resolvedTokenId);
        setIssuedToken('');
        if (resolvedTokenId === tokenId) {
          setTokenId('');
        }
        await refreshGateway();
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : String(error || 'Revoke token failed'));
      } finally {
        setBusy(false);
      }
    })();
  };

  const gatewayEnabled = !statusText.includes('unavailable') && !statusText.includes('Disabled') && !statusText.includes('Loading');

  return (
    <div className="space-y-4">
      <Card className="space-y-3 p-4">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="text-sm font-semibold text-gray-900">Gateway Status & Issue Token</h4>
            <p className="text-xs text-gray-500">External Agent Access gateway and token issuance.</p>
          </div>
          <div className="flex items-center gap-2">
            <span className={`inline-block h-2.5 w-2.5 rounded-full ${gatewayEnabled ? 'bg-emerald-500' : 'bg-gray-300'}`} />
            <span className="text-xs text-gray-600">{gatewayEnabled ? 'Enabled' : 'Disabled'}</span>
          </div>
        </div>
        <p className="text-[11px] text-gray-500">{statusText}</p>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Input
            label="Principal ID"
            value={principalId}
            onChange={setPrincipalId}
            placeholder="openclaw.local"
          />
          <Input
            label="Subject Account ID"
            value={subjectAccountId}
            onChange={setSubjectAccountId}
            placeholder="user_123 / external_456"
          />
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">Mode</label>
            <RuntimeSelect
              value={mode}
              onChange={(nextMode) => setMode(nextMode === 'autonomous' ? 'autonomous' : 'delegated')}
              className="w-full"
              options={[
                { value: 'delegated', label: 'delegated' },
                { value: 'autonomous', label: 'autonomous' },
              ]}
            />
          </div>
          <Input
            label="TTL Seconds"
            value={ttlSeconds}
            onChange={setTtlSeconds}
            placeholder="3600"
          />
        </div>

        <Input
          label="Action Scopes (comma separated)"
          value={actionsInput}
          onChange={setActionsInput}
          placeholder="runtime.local-ai.models.list"
        />

        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" disabled={busy} onClick={handleIssueToken}>
            {busy ? 'Issuing...' : 'Issue Token'}
          </Button>
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => { void refreshGateway(); }}>
            Refresh
          </Button>
        </div>

        {tokenId ? (
          <p className="text-[11px] text-gray-500">tokenId: {tokenId}</p>
        ) : null}
        {issuedToken ? (
          <div className="space-y-1.5">
            <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-[11px] text-amber-900 break-all">
              {issuedToken}
            </div>
            <Button variant="ghost" size="sm" disabled={busy || !tokenId.trim()} onClick={() => handleRevokeToken()}>
              Revoke This Token
            </Button>
          </div>
        ) : null}
        {errorMessage ? (
          <p className="text-xs text-red-600">{errorMessage}</p>
        ) : null}
      </Card>

      <Card className="space-y-3 p-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-gray-900">Issued Tokens</p>
          <p className="text-xs text-gray-500">{tokens.length} token{tokens.length !== 1 ? 's' : ''}</p>
        </div>
        {tokens.length <= 0 ? (
          <p className="text-xs text-gray-500">No tokens issued.</p>
        ) : (
          <div className="max-h-64 space-y-2 overflow-auto">
            {tokens.map((token) => {
              const isRevoked = Boolean(token.revokedAt);
              const isExpired = token.expiresAt && new Date(token.expiresAt).getTime() < Date.now();
              const tokenStatus = isRevoked ? 'revoked' : isExpired ? 'expired' : 'active';
              const statusColor = tokenStatus === 'active'
                ? 'border-emerald-200 bg-emerald-50'
                : tokenStatus === 'expired'
                  ? 'border-amber-200 bg-amber-50'
                  : 'border-gray-200 bg-gray-50';
              return (
                <div key={token.tokenId} className={`rounded-[10px] border p-3 text-[11px] text-gray-700 ${statusColor}`}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-900">{token.principalId}</span>
                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                        tokenStatus === 'active'
                          ? 'bg-emerald-100 text-emerald-800'
                          : tokenStatus === 'expired'
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-gray-100 text-gray-600'
                      }`}>
                        {tokenStatus}
                      </span>
                    </div>
                    {!isRevoked ? (
                      <button
                        type="button"
                        className="text-[11px] font-medium text-red-600 hover:text-red-700 disabled:text-gray-400"
                        disabled={busy}
                        onClick={() => handleRevokeToken(token.tokenId)}
                      >
                        Revoke
                      </button>
                    ) : null}
                  </div>
                  <p className="mt-1">mode: {token.mode} · subject: {token.subjectAccountId || '-'}</p>
                  <p>expires: {token.expiresAt || '-'}</p>
                  {token.revokedAt ? <p>revoked: {token.revokedAt}</p> : null}
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
