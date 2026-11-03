import { useId, useState } from 'react';
import { Button, IconButton, Popover, PopoverContent, PopoverTrigger, SearchField, StatusBadge } from '@nimiplatform/kit/ui';
import { Check, Cloud, History, ListFilter, PencilLine, Plus } from 'lucide-react';
import type { HeroDemo } from '../content/landing-content.js';
import { capabilityLabel, cloudSetupTarget, endpointHost, newCloudExample, ownerOptions, providerFor, type CloudExample, type CloudText, type CloudUse, type DemoCloudModel, type DemoConnection } from '../content/demo-cloud-data.js';
import { DemoCloudCatalog, DemoCloudUseDialog } from './demo-cloud-catalog.js';
import { DemoCloudUsage, DemoCloudHistory } from './demo-cloud-activity.js';
import { DemoCloudForm } from './demo-cloud-form.js';
import { CloudProviderMark } from './demo-cloud-provider.js';
import { demoText } from './demo-home-ui.js';
import { useHeroDemoSession } from './hero-demo-context.js';

type Panel = { type: 'add' | 'edit' } | { type: 'history'; scoped: boolean; days: number } | { type: 'use'; model: DemoCloudModel };
type Filter = 'all' | 'attention' | 'unchecked';
const tabs = ['models', 'references', 'usage'] as const;

function matches(connection: DemoConnection, query: string, filter: Filter) {
  const provider = providerFor(connection.provider);
  return (filter === 'all' || connection.status === (filter === 'attention' ? 'credential' : 'unchecked'))
    && [connection.name, provider.name, connection.endpoint].join(' ').toLowerCase().includes(query.trim().toLowerCase());
}
function statusText(connection: DemoConnection, t: CloudText) {
  if (connection.status === 'checked') return t('检查通过', 'Check passed');
  if (connection.status === 'credential') return t('待添加凭据', 'Needs credentials');
  return t('未检查', 'Not checked');
}

// @nimi-authority: rule.nimi.desktop.ai-consumption.cloud-services-workspace
export function DemoCloudSurface({ demo, target }: { demo: HeroDemo; target?: string }) {
  const { cloud: saved, setCloud, navigate } = useHeroDemoSession();
  const [initial] = useState(newCloudExample);
  const cloud = saved ?? initial;
  const update = (change: (old: CloudExample) => CloudExample) => setCloud(old => change(old ?? initial));
  const t = demoText(demo);
  const returning = cloud.connections.find(c => c.id === target);
  const [selection, setSelection] = useState(returning?.id ?? cloud.connections[0]?.id);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [filterOpen, setFilterOpen] = useState(false);
  const [tab, setTab] = useState<(typeof tabs)[number]>(returning ? 'references' : 'models');
  const [panel, setPanel] = useState<Panel | null>(null);
  const [feedback, setFeedback] = useState('');
  const tabId = useId();
  const current = cloud.connections.find(item => item.id === selection) ?? cloud.connections[0];
  const refs = cloud.uses.filter(use => use.connectionId === current?.id);
  const visible = cloud.connections.filter(c => matches(c, query, filter));
  const unchecked = cloud.connections.filter(c => c.status === 'unchecked').length;
  const labels = { all: t('全部', 'All'), attention: t('需处理', 'Needs attention'), unchecked: t('未检查', 'Unchecked') };
  const tabLabels = { models: t('模型', 'Models'), references: t('应用配置', 'App configurations'), usage: t('用量', 'Usage') };
  const select = (id: string) => { setSelection(id); setTab('models'); setFeedback(''); };
  const chooseFilter = (value: Filter) => {
    const rows = cloud.connections.filter(c => matches(c, query, value));
    if (rows[0] && !rows.some(c => c.id === current?.id)) select(rows[0].id);
    setFilter(value);
    setFilterOpen(false);
  };
  const saveConnection = (value: DemoConnection) => {
    update(old => ({ ...old, connections: old.connections.some(c => c.id === value.id)
      ? old.connections.map(c => c.id === value.id ? value : c) : [...old.connections, value] }));
    setQuery(''); setFilter('all'); select(value.id); setPanel(null);
  };
  const removeConnection = () => {
    update(old => ({ ...old, connections: old.connections.filter(c => c.id !== current?.id) }));
    setPanel(null); setQuery(''); setFilter('all'); setTab('models'); setFeedback('');
  };
  const openSetup = (use: CloudUse) => {
    const destination = cloudSetupTarget(use);
    update(old => old.drafts[destination] ? old : { ...old, drafts: { ...old.drafts, [destination]: use } });
    setPanel(null);
    navigate('runtime', destination);
  };
  const addButton = <Button size="sm" tone="primary" data-tour-anchor="cloud-add" onClick={() => setPanel({ type: 'add' })}><Plus size={14} />{t('添加云服务', 'Add cloud service')}</Button>;
  const historyButton = <Button size="sm" tone="ghost" onClick={() => setPanel({ type: 'history', scoped: false, days: 7 })}><History size={14} />{t('调用记录', 'Call history')}</Button>;
  const hasRail = cloud.connections.length > 1;
  const provider = current && providerFor(current.provider);
  return <div className="demo-workspace demo-cloud-workspace">
    {hasRail && <aside className="demo-module-sidebar cloud-rail">
      <header><h2>{demo.nav.cloud}</h2><p>{t(`我的连接（${cloud.connections.length}）`, `My connections (${cloud.connections.length})`)}</p></header>
      <div className="cloud-rail-tools"><SearchField value={query} onChange={e => setQuery(e.currentTarget.value)} onClear={() => setQuery('')}
        aria-label={t('搜索连接', 'Search connections')} placeholder={t('搜索连接', 'Search connections')} />
        <Popover open={filterOpen} onOpenChange={setFilterOpen}><PopoverTrigger asChild>
          <IconButton tone="ghost" size="sm" aria-label={t('筛选连接', 'Filter connections') + ' · ' + labels[filter]} icon={<ListFilter size={16} />} />
        </PopoverTrigger><PopoverContent align="end" sideOffset={5} className="cloud-filter-menu">
          {(Object.keys(labels) as Filter[]).map(value => <button key={value} type="button" aria-pressed={filter === value} onClick={() => chooseFilter(value)}>{labels[value]}{filter === value && <Check size={14} />}</button>)}
        </PopoverContent></Popover>
      </div>
      {filter === 'all' && !query.trim() && unchecked > 0 && <small className="cloud-rail-note">{t(`有 ${unchecked} 个连接尚未检查。`, `${unchecked} connection(s) have not been checked.`)}</small>}
      {current && !visible.some(c => c.id === current.id) && <small className="cloud-rail-note">
        {t(`当前连接「${current.name}」不在筛选结果中。`, `The selection, ${current.name}, is outside this filter.`)}{' '}
        <button type="button" onClick={() => { setQuery(''); setFilter('all'); }}>{t('清除筛选', 'Clear filter')}</button>
      </small>}
      <div className="cloud-rail-list">{visible.map(item => {
        const p = providerFor(item.provider);
        const duplicate = cloud.connections.some(other => other.id !== item.id && other.name.toLowerCase() === item.name.toLowerCase());
        const host = item.endpoint !== p.defaultEndpoint || duplicate ? endpointHost(item.endpoint) : '';
        return <button type="button" className="cloud-rail-row" key={item.id} aria-current={current?.id === item.id ? 'page' : undefined} onClick={() => select(item.id)}>
          <CloudProviderMark provider={p} /><span><strong>{item.name}</strong>
            {(item.name !== p.name || host) && <small>{[item.name !== p.name ? p.name : '', host].filter(Boolean).join(' · ')}</small>}
            {duplicate && <small className="cloud-id">{item.id}</small>}
            <small className="cloud-rail-status" data-status={item.status}>{statusText(item, t)}</small>
          </span></button>;
      })}{!visible.length && <p className="cloud-empty">{t('没有符合当前搜索或筛选条件的连接。', 'No connections match your search or filter.')}</p>}</div>
      <div className="demo-sidebar-footer cloud-rail-footer">{addButton}{historyButton}</div>
    </aside>}
    <div className="demo-module-content cloud-detail">
      {!hasRail && <div className="cloud-title-row"><h2>{demo.nav.cloud}</h2><div className="cloud-form-actions">{historyButton}{current && addButton}</div></div>}
      {current && provider ? <>
        <header className="cloud-detail-heading">
          <CloudProviderMark provider={provider} large />
          <div className="cloud-identity"><div><h1>{current.name}</h1><StatusBadge tone={current.status === 'checked' ? 'success' : current.status === 'unchecked' ? 'neutral' : 'danger'}>{statusText(current, t)}</StatusBadge></div>
            <p>{[current.name !== provider.name ? provider.name : '', endpointHost(current.endpoint)].filter(Boolean).join(' · ')}</p></div>
          <div className="cloud-heading-buttons">
            <Button size="sm" tone="ghost" onClick={() => setPanel({ type: 'edit' })}><PencilLine size={14} />{t('编辑连接', 'Edit connection')}</Button>
            {current.status === 'credential' ? <Button size="sm" tone="primary" onClick={() => setPanel({ type: 'edit' })}>{t('添加凭据', 'Add credentials')}</Button> :
              <Button size="sm" tone="ghost" onClick={() => setFeedback(t('此处展示连接检查的入口。真实检查需要在 Home 使用已保存的凭据，本页没有发送请求。', 'In Home this checks the saved credential. This preview did not send a request.'))}>
                {current.status === 'checked' ? t('再次检查', 'Check again') : t('检查连接', 'Check connection')}</Button>}
          </div>
        </header>
        <section className="cloud-summary">
          {feedback && <p role="status" className="cloud-feedback">{feedback}</p>}
          {current.status === 'checked' && <small>{t('上次检查：今天 10:24（示例）', 'Last checked today at 10:24 (example)')}</small>}
          <p>{t('当前账户的连接。', 'Connection for the current account.')} {current.auth === 'api_key' && t('用量由服务商计费。', 'Usage is billed by the provider.')}</p>
          <details><summary>{t('计费与数据说明', 'Billing & data details')}</summary><p>{t('云端推理会将所需内容发送给所选服务商。实际费用、数据处理与保留规则由服务商决定。', 'Cloud inference sends the necessary content to the chosen provider. Its billing and data policies apply.')}</p></details>
        </section>
        <section className="cloud-card" key={current.id}>
          <div className="cloud-tabs" role="tablist" aria-label={t('连接内容', 'Connection sections')}>
            {tabs.map((id, i) => <button type="button" key={id} id={tabId + id} role="tab" aria-controls={tabId + '-panel'} aria-selected={tab === id} tabIndex={tab === id ? 0 : -1}
              onClick={() => setTab(id)} onKeyDown={e => {
                const next = e.key === 'ArrowRight' ? (i + 1) % 3 : e.key === 'ArrowLeft' ? (i + 2) % 3 : e.key === 'Home' ? 0 : e.key === 'End' ? 2 : -1;
                if (next < 0) return;
                e.preventDefault(); setTab(tabs[next]!); document.getElementById(tabId + tabs[next])?.focus();
              }}>{tabLabels[id]}</button>)}
          </div>
          <div role="tabpanel" id={tabId + '-panel'} aria-labelledby={tabId + tab}>
            {tab === 'models' ? <DemoCloudCatalog connection={current} demo={demo} t={t} onConfigure={model => setPanel({ type: 'use', model })} /> :
              tab === 'usage' ? <DemoCloudUsage connection={current} t={t} openHistory={days => setPanel({ type: 'history', scoped: true, days })} /> :
              <div className="cloud-pane"><h3>{t('已保存的应用配置', 'Saved app configurations')}</h3>
                <p className="cloud-muted">{t('本页示例中已保存的配置。存在引用不代表正在调用模型。', 'Saved configurations in this example. A reference does not mean the model is running.')}</p>
                {refs.length ? <ul className="cloud-rows">{refs.map(use => {
                  const owner = ownerOptions(use.capability, t).find(o => o.id === use.owner);
                  return <li key={use.owner + use.capability}><div><strong>{owner?.name}</strong><small>{capabilityLabel(use.capability, demo)} · {use.model}</small></div>
                    <Button size="sm" tone="secondary" onClick={() => openSetup(use)}>{t('打开配置', 'Open configuration')}</Button></li>;
                })}</ul> : <p className="cloud-empty">{t('还没有已保存的配置引用这条连接。', 'No saved configuration refers to this connection.')}</p>}
              </div>}
          </div>
        </section>
      </> : <section className="cloud-first-run" data-tour-anchor="cloud-catalog"><Cloud size={36} /><h2>{t('还没有连接云服务', 'No cloud services connected')}</h2>
        <p>{t('添加服务商后，可以查看模型并为应用选择配置。', 'Add a provider to browse its models and choose a configuration for an app.')}</p>{addButton}</section>}
    </div>
    {(panel?.type === 'add' || (panel?.type === 'edit' && current)) && <DemoCloudForm connection={panel.type === 'edit' ? current : undefined}
      connected={cloud.connections.map(item => item.provider)} references={refs.length} onSave={saveConnection} onRemove={removeConnection} onClose={() => setPanel(null)} t={t} />}
    {panel?.type === 'history' && <DemoCloudHistory connection={panel.scoped ? current : undefined} initialDays={panel.days} t={t} onClose={() => setPanel(null)} />}
    {panel?.type === 'use' && current && <DemoCloudUseDialog key={panel.model.id} connection={current} model={panel.model}
      demo={demo} t={t} onClose={() => setPanel(null)} onChoose={openSetup} />}
  </div>;
}
