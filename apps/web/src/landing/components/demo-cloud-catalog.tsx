import { useState } from 'react';
import { ArrowRight, Bot, Cloud, Search } from 'lucide-react';
import { Button, OverlayShell, SearchField } from '@nimiplatform/kit/ui';
import { capabilityLabel, modelsFor, ownerOptions, providerFor, type CloudText, type CloudUse, type DemoCloudModel, type DemoConnection } from '../content/demo-cloud-data.js';
import type { HeroDemo } from '../content/landing-content.js';

export function DemoCloudCatalog({ connection, demo, t, onConfigure }: {
  connection: DemoConnection; demo: HeroDemo; t: CloudText; onConfigure: (row: DemoCloudModel) => void;
}) {
  const [query, setQuery] = useState('');
  const [capability, setCapability] = useState('');
  const [limit, setLimit] = useState(20);
  const [refreshed, setRefreshed] = useState(false);
  const rows = modelsFor(connection.provider);
  const capabilities = [...new Set(rows.flatMap(row => row.capabilities))];
  const filtered = rows.filter(row => (!capability || row.capabilities.includes(capability))
    && [row.label, row.id, ...row.capabilities.map(cap => cap + ' ' + capabilityLabel(cap, demo))].join(' ').toLowerCase().includes(query.trim().toLowerCase()));
  const dynamic = providerFor(connection.provider).inventoryMode === 'dynamic_endpoint';
  return <div className="cloud-pane">
    <div className="cloud-title-row"><h3>{t('模型目录', 'Model catalog')} <small>{rows.length}</small></h3>
      <Button size="sm" tone="ghost" onClick={() => { setLimit(20); setRefreshed(true); }}>{t('刷新目录', 'Refresh catalog')}</Button></div>
    <p className="cloud-muted">{t('选择模型，再配置给需要它的应用。', 'Choose a model, then configure it for the app that needs it.')}</p>
    {refreshed && <small role="status">{t("已重新显示随附目录。", "The bundled catalog has been refreshed.")}</small>}
    {rows.length > 0 && <div className="cloud-tools"><SearchField value={query} onChange={e => { setQuery(e.target.value); setLimit(20); }}
      onClear={() => setQuery('')} aria-label={t('搜索模型或能力', 'Search models or capabilities')} placeholder={t('搜索模型或能力', 'Search models or capabilities')} />
      {capabilities.length > 1 && <select aria-label={t('能力', 'Capability')} value={capability} onChange={e => { setCapability(e.target.value); setLimit(20); }}>
        <option value="">{t('全部能力', 'All capabilities')}</option>
        {capabilities.map(cap => <option key={cap} value={cap}>{capabilityLabel(cap, demo)}</option>)}
      </select>}
    </div>}
    <div data-tour-anchor="cloud-catalog">
      {!filtered.length && <p role="status" className="cloud-empty">{rows.length ? t('没有匹配的模型，试试其他名称或能力。', 'No matching models. Try another name or capability.') :
        dynamic ? t('这个服务的模型需要在 Home 中从连接端点读取。网页未连接服务。', 'Home reads this provider’s models from the connected endpoint. This preview is offline.') :
        t("此服务没有随附的模型。", "There are no bundled models for this provider.")}</p>}
      <ul className="cloud-rows">{filtered.slice(0, limit).map(row => <li key={row.id}>
        <div><strong>{row.label}</strong>{row.label !== row.id && <code>{row.id}</code>}
          <small>{row.capabilities.map(cap => capabilityLabel(cap, demo)).join(' · ')}</small></div>
        <Button size="sm" tone="secondary" disabled={!row.capabilities.length} onClick={() => onConfigure(row)}>{t('配置到应用', 'Use in an app')}</Button>
      </li>)}</ul>
    </div>
    {filtered.length > 20 && <div className="cloud-title-row"><small>{t(`已显示 ${Math.min(limit, filtered.length)} / ${filtered.length} 个模型`, `Showing ${Math.min(limit, filtered.length)} of ${filtered.length} models`)}</small>
      {limit < filtered.length && <Button size="sm" tone="ghost" onClick={() => setLimit(limit + 20)}>{t('加载更多', 'Load more')}</Button>}</div>}
    <details className="cloud-explanation"><summary>{t('关于此目录', 'About this catalog')}</summary>
      <p>{t('此处展示 Nimi 随附的模型目录。列出模型不代表账户具备权限或调用必定成功；Home 会从 Runtime 读取当前连接的实际目录。', 'These examples use the catalog bundled with Nimi. An entry does not establish account access or a successful call. Home reads the actual catalog from Runtime.')}</p></details>
  </div>;
}

export function DemoCloudUseDialog({ connection, model, demo, t, onClose, onChoose }: {
  connection: DemoConnection; model: DemoCloudModel; demo: HeroDemo; t: CloudText;
  onClose: () => void; onChoose: (use: CloudUse) => void;
}) {
  const [cap, setCap] = useState(model.capabilities[0]!);
  const [query, setQuery] = useState('');
  const owners = ownerOptions(cap, t);
  const visible = owners.filter(owner => owner.name.toLowerCase().includes(query.trim().toLowerCase()));
  return <OverlayShell open kind="dialog" size="md" onClose={onClose} dataTestId="demo-cloud-use"
    title={t('选择使用这个模型的应用', 'Choose an app for this model')}>
    <div className="cloud-form">
      <p className="cloud-model-token"><Cloud size={16} />{model.label}</p>
      {model.capabilities.length > 1 ? <label className="cloud-field">{t('能力', 'Capability')}<select value={cap} onChange={e => { setCap(e.target.value); setQuery(''); }}>
        {model.capabilities.map(id => <option key={id} value={id}>{capabilityLabel(id, demo)}</option>)}
      </select></label> : <small>{capabilityLabel(cap, demo)}</small>}
      {owners.length > 6 && <SearchField value={query} onChange={e => setQuery(e.currentTarget.value)} onClear={() => setQuery('')}
        aria-label={t('搜索应用或智能体配置', 'Search apps or agent configuration')} placeholder={t('搜索应用或智能体配置', 'Search apps or agent configuration')} />}
      <div className="cloud-owner-list">{visible.map(owner => {
        const icon = demo.apps.items.find(app => app.id === owner.id)?.iconSrc;
        return <button type="button" key={owner.id} onClick={() => onChoose({ owner: owner.id, capability: cap, connectionId: connection.id, model: model.id })}>
          {icon ? <img src={icon} alt="" /> : owner.id === 'local-agent' ? <Bot /> : <span>{owner.name.slice(0, 1)}</span>}
          <strong>{owner.name}</strong><ArrowRight size={15} />
        </button>;
      })}</div>
      {!visible.length && <p className="cloud-empty"><Search size={16} /> {t('没有匹配的使用方。', 'No matching consumers.')}</p>}
      <p className="cloud-muted">{t('先选择要用于何处，下一步再确认模型并保存。此处不会发起 AI 请求。', 'Choose where to use it. Review and save the model in the next step. No AI request is sent here.')}</p>
      <Button size="sm" tone="ghost" onClick={onClose}>{t('取消', 'Cancel')}</Button>
    </div>
  </OverlayShell>;
}
