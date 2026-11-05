import { useState } from 'react';
import type { TFunction } from 'i18next';
import type { ConnectorMediaStorageUpdate } from '@nimiplatform/sdk/runtime/wire-types';
import { Button, Surface, TextField } from '@nimiplatform/kit/ui';
import type { ApiConnector } from './runtime-config-state-types.js';
import { useRuntimeConfigConnectorSdk } from './runtime-config-connector-sdk-context.js';
import { humanizeConnectorError } from './runtime-config-connector-error-copy.js';

// @nimi-authority: rule.nimi.runtime.ai-provider.oss-input-storage
export function CloudMediaStorage(props: {
  connector: ApiConnector;
  disabled: boolean;
  onSaved: (connector: ApiConnector) => void;
  t: TFunction;
}) {
  const { connector, t } = props;
  const sdk = useRuntimeConfigConnectorSdk();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [region, setRegion] = useState(connector.mediaStorage?.region ?? '');
  const [bucket, setBucket] = useState(connector.mediaStorage?.bucket ?? '');
  const [prefix, setPrefix] = useState(connector.mediaStorage?.keyPrefix ?? 'nimi-input/');
  const [accessKeyId, setAccessKeyId] = useState('');
  const [accessKeySecret, setAccessKeySecret] = useState('');
  const [securityToken, setSecurityToken] = useState('');
  const clearSecrets = () => { setAccessKeyId(''); setAccessKeySecret(''); setSecurityToken(''); };
  const beginEditing = () => {
    setRegion(connector.mediaStorage?.region ?? '');
    setBucket(connector.mediaStorage?.bucket ?? '');
    setPrefix(connector.mediaStorage?.keyPrefix ?? 'nimi-input/');
    clearSecrets(); setError(''); setEditing(true);
  };

  async function commit(mediaStorage: ConnectorMediaStorageUpdate) {
    setBusy(true); setError('');
    try {
      const saved = await sdk.sdkUpdateConnector({ connectorId: connector.id, mediaStorage });
      if (!saved) throw new Error(t('runtimeConfig.product.connectionSaveFailed'));
      props.onSaved(saved);
      clearSecrets();
      setEditing(false);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      const invalid = (cause !== null && typeof cause === 'object' && 'reasonCode' in cause && cause.reasonCode === 'AI_CONNECTOR_INVALID') || message.includes('AI_CONNECTOR_INVALID');
      setError(invalid ? t('runtimeConfig.mediaStorage.invalid') : humanizeConnectorError(message, t, 'save'));
    } finally { setBusy(false); }
  }

  const fields = [
    { key: 'region', value: region, set: setRegion, placeholder: 'cn-beijing' },
    { key: 'bucket', value: bucket, set: setBucket, placeholder: 'my-input-bucket' },
    { key: 'prefix', value: prefix, set: setPrefix, placeholder: 'nimi-input/' },
    { key: 'accessKeyId', value: accessKeyId, set: setAccessKeyId },
    { key: 'accessKeySecret', value: accessKeySecret, set: setAccessKeySecret, secret: true },
    { key: 'securityToken', value: securityToken, set: setSecurityToken, secret: true, optional: true },
  ];
  return <Surface as="section" padding="none" className="desktop-module-card" data-testid="cloud-media-storage">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <h2 className="text-base font-semibold">{t('runtimeConfig.mediaStorage.title')}</h2>
        <p className="mt-1 text-sm text-[var(--nimi-text-secondary)]">{t('runtimeConfig.mediaStorage.description')}</p>
        {connector.mediaStorage ? <p className="mt-2 break-all text-sm">{connector.mediaStorage.bucket} · {connector.mediaStorage.region} · {connector.mediaStorage.keyPrefix}</p> : null}
        <p className="mt-1 text-xs text-[var(--nimi-text-muted)]">{t(connector.mediaStorage ? 'runtimeConfig.mediaStorage.configured' : 'runtimeConfig.mediaStorage.unconfigured')}</p>
      </div>
      {!editing ? <Button size="sm" tone="secondary" disabled={props.disabled || busy} onClick={beginEditing}>{t(connector.mediaStorage ? 'runtimeConfig.mediaStorage.replace' : 'runtimeConfig.mediaStorage.configure')}</Button> : null}
    </div>
    {editing ? <form className="mt-4 space-y-4" onSubmit={event => {
      event.preventDefault();
      void commit({ change: { oneofKind: 'oss', oss: { config: { region: region.trim(), bucket: bucket.trim(), keyPrefix: prefix.trim() }, accessKeyId: accessKeyId.trim(), accessKeySecret: accessKeySecret.trim(), securityToken: securityToken.trim() } } });
    }}>
      <p className="text-sm text-[var(--nimi-text-secondary)]">{t('runtimeConfig.mediaStorage.requirements')}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map(field => <label key={field.key} className="grid gap-1 text-sm">
          {t(`runtimeConfig.mediaStorage.fields.${field.key}`)}
          <TextField value={field.value} onChange={event => field.set(event.target.value)} type={field.secret ? 'password' : 'text'} autoComplete="off" placeholder={field.placeholder} required={!field.optional} disabled={props.disabled || busy} />
        </label>)}
      </div>
      <p className="text-xs text-[var(--nimi-text-muted)]">{t('runtimeConfig.mediaStorage.dataHandling')}</p>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" tone="primary" disabled={props.disabled || busy}>{t(busy ? 'Common.saving' : 'Common.save')}</Button>
        <Button type="button" size="sm" tone="ghost" disabled={busy} onClick={() => { clearSecrets(); setEditing(false); setError(''); }}>{t('Common.cancel')}</Button>
        {connector.mediaStorage ? <Button type="button" size="sm" tone="ghost" disabled={props.disabled || busy} onClick={() => void commit({ change: { oneofKind: 'remove', remove: true } })}>{t('runtimeConfig.mediaStorage.remove')}</Button> : null}
      </div>
    </form> : null}
    {error ? <p role="alert" className="mt-3 text-sm text-[var(--nimi-status-danger-soft-text)]">{error}</p> : null}
  </Surface>;
}
