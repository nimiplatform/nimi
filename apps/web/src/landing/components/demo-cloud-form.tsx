import { useState } from 'react';
import { ArrowLeft, ChevronDown, KeyRound, SlidersHorizontal } from 'lucide-react';
import { Button, OverlayShell, SearchField } from '@nimiplatform/kit/ui';
import { isNimiBrowserManagedConnectorProfile } from '@nimiplatform/sdk/runtime';
import { authOptions, cloudProviders, providerFor, type CloudText, type DemoConnection } from '../content/demo-cloud-data.js';
import { CloudProviderMark } from './demo-cloud-provider.js';

function usableEndpoint(value: string) {
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password;
  } catch { return false; }
}

export function DemoCloudForm({ connection, connected, references, onSave, onRemove, onClose, t }: {
  connection?: DemoConnection; connected: readonly string[]; references: number;
  onSave: (value: DemoConnection) => void; onRemove: () => void; onClose: () => void; t: CloudText;
}) {
  const [providerId, setProviderId] = useState(connection?.provider ?? '');
  const [query, setQuery] = useState('');
  const [name, setName] = useState(connection?.name ?? '');
  const [endpoint, setEndpoint] = useState(connection?.endpoint ?? '');
  const [auth, setAuth] = useState(connection?.auth ?? '');
  const [sampleKey, setSampleKey] = useState(false);
  const [removing, setRemoving] = useState(false);
  const provider = providerId ? providerFor(providerId) : undefined;
  const options = provider ? authOptions(providerId) : [];
  const method = options.find(option => option.value === auth) ?? options[0];
  const managed = method?.authMode === 'oauth_managed';
  const browserSignIn = isNimiBrowserManagedConnectorProfile(method?.providerAuthProfile);
  const choose = (id: string) => {
    setProviderId(id);
    setEndpoint(providerFor(id).defaultEndpoint);
    setAuth('');
    setSampleKey(false);
  };
  const matches = cloudProviders.filter(p => (p.name + ' ' + p.provider).toLowerCase().includes(query.trim().toLowerCase()));
  const groups = [
    { title: t('其他服务', 'Other services'), items: matches.filter(p => !connected.includes(p.provider)) },
    { title: t('已连接过', 'Already connected'), items: matches.filter(p => connected.includes(p.provider)) },
  ].filter(group => group.items.length);
  const hasKey = sampleKey || (connection && connection.auth === method?.value && connection.status !== 'credential');
  const validEndpoint = usableEndpoint(endpoint);
  const save = () => {
    if (!provider || !method || !validEndpoint || (!managed && !hasKey)) return;
    onSave({
      id: connection?.id ?? crypto.randomUUID(), provider: providerId, name: name.trim() || provider.name,
      endpoint: endpoint.trim(), auth: method.value,
      status: managed && !hasKey ? 'credential' : connection && !sampleKey && endpoint.trim() === connection.endpoint && method.value === connection.auth ? connection.status : 'unchecked',
    });
  };
  return <OverlayShell open kind={connection ? 'drawer' : 'dialog'} size={connection ? 'sm' : 'md'} onClose={onClose}
    title={connection ? t('编辑连接', 'Edit connection') : t('添加云服务', 'Add cloud service')} dataTestId="demo-cloud-form">
    <div className="cloud-form">
      {!provider ? <>
        <p>{t('选择要连接的服务，再按提示填写所需信息。', 'Choose a service, then fill in its connection details.')}</p>
        <SearchField autoFocus value={query} onChange={e => setQuery(e.currentTarget.value)} onClear={() => setQuery('')}
          aria-label={t('搜索服务商', 'Search providers')} placeholder={t('搜索服务商', 'Search providers')} />
        <div className="cloud-provider-scroll">
          {groups.map(group => <section key={group.title}>
            {connected.length > 0 && <h3>{group.title}</h3>}
            <div className="cloud-provider-grid">{group.items.map(p => (
              <button type="button" key={p.provider} onClick={() => choose(p.provider)}>
                <CloudProviderMark provider={p} /><strong>{p.name}</strong>
                {p.requiresExplicitEndpoint && <small>{t('需填写地址', 'Endpoint required')}</small>}
              </button>
            ))}</div>
          </section>)}
          {!groups.length && <p className="cloud-empty">{t('没有匹配的服务，试试其他名称。', 'No matching services. Try another name.')}</p>}
        </div>
        <Button size="sm" tone="secondary" onClick={onClose}>{t('取消', 'Cancel')}</Button>
      </> : <>
        <div className="cloud-form-title"><CloudProviderMark provider={provider} /><strong>{provider.name}</strong>
          {!connection && <Button size="sm" tone="ghost" onClick={() => setProviderId('')}><ArrowLeft size={14} />{t('更换服务', 'Change service')}</Button>}
        </div>
        <details className="cloud-advanced" key={providerId} open={!provider.defaultEndpoint}>
          <summary><SlidersHorizontal size={16} />{t('高级：端点与凭证类型', 'Advanced: endpoint and credential type')}<ChevronDown size={14} /></summary>
          <div><label className="cloud-field">{t('服务商', 'Provider')}<select value={providerId} disabled={Boolean(connection)} onChange={e => choose(e.target.value)}>
            {cloudProviders.map(p => <option key={p.provider} value={p.provider}>{p.name}</option>)}
          </select></label>
          {!browserSignIn && <label className="cloud-field">{t('端点', 'Endpoint')}<input value={endpoint} type="url" spellCheck={false} placeholder="https://…" onChange={e => setEndpoint(e.target.value)} />
            {!validEndpoint && <small>{t('填写完整的 HTTP 或 HTTPS 服务地址。', 'Enter the full HTTP or HTTPS service address.')}</small>}</label>}
          {options.length > 1 && <label className="cloud-field">{t('凭证类型', 'Credential type')}<select value={method?.value} onChange={e => { setAuth(e.target.value); setSampleKey(false); }}>
            {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select></label>}</div>
        </details>
        {!managed ? <div className="cloud-key-example">
          <label className="cloud-field">{t('API 密钥', 'API key')}<input type="password" readOnly value={sampleKey ? 'demo-only' : ''} autoComplete="off"
            placeholder={connection ? t('留空保留已有凭据', 'Leave blank to keep the credential') : t("请使用下方的预置密钥", "Use the preset key below")} /></label>
          <Button size="sm" tone="secondary" disabled={sampleKey} onClick={() => setSampleKey(true)}><KeyRound size={14} />{sampleKey ? t("已填入预置密钥", "Preset key filled in") : t("使用预置密钥", "Use preset key")}</Button>
          <small>{t('网页只接受内置样例。真实密钥由桌面端的本机 Runtime 管理。', 'Only the built-in sample is used here. The desktop Runtime manages real credentials.')}</small>
        </div> : <div className="cloud-auth-note">
          <strong>{browserSignIn ? t('在桌面端登录 ChatGPT', 'Sign in to ChatGPT in the desktop app') : t('由宿主管理授权', 'Host-managed authorization')}</strong>
          <p>{t('在 Home 中完成授权后才能使用。这里仅预览待授权的连接，不会启动登录。', 'Authorize the connection in Home before use. This previews a connection awaiting credentials without starting sign-in.')}</p>
        </div>}
        <label className="cloud-field">{t('名称（可选）', 'Name (optional)')}<input value={name} maxLength={100} placeholder={provider.name} onChange={e => setName(e.target.value)} /></label>
        <div className="cloud-form-actions"><Button size="sm" tone="primary" disabled={!validEndpoint || !method || (!managed && !hasKey)} onClick={save}>
          {managed && !hasKey ? t('预览待授权连接', 'Preview pending connection') : t("保存连接", "Save connection")}
        </Button><Button size="sm" tone="secondary" onClick={onClose}>{t('取消', 'Cancel')}</Button></div>
        {connection && <div className="cloud-remove">
          {removing ? <><p>{t(`移除「${connection.name}」？引用它的配置（${references}）将需要重新选择连接。`, `Remove “${connection.name}”? Its ${references} configuration references will need another connection.`)}</p>
            <Button size="sm" tone="secondary" onClick={onRemove}>{t('确认移除', 'Confirm removal')}</Button>
            <Button size="sm" tone="ghost" onClick={() => setRemoving(false)}>{t('取消', 'Cancel')}</Button></> :
            <Button size="sm" tone="ghost" onClick={() => setRemoving(true)}>{t('移除连接', 'Remove connection')}</Button>}
        </div>}
      </>}
    </div>
  </OverlayShell>;
}
