import { useState } from 'react';
import { ArrowLeft, Check, Cloud } from 'lucide-react';
import { Button, SearchField } from '@nimiplatform/kit/ui';
import { capabilityLabel, cloudSetupTarget, modelsFor, ownerOptions, type CloudUse } from '../content/demo-cloud-data.js';
import type { HeroDemo } from '../content/landing-content.js';
import { useHeroDemoSession } from './hero-demo-context.js';
import { demoText } from './demo-home-ui.js';

/** The cloud model task is an AI Capabilities destination. Its draft belongs
 * to one consumer/capability, independently of the catalog and saved uses. */
export function DemoCloudSetup({ target, demo }: { target: string; demo: HeroDemo }) {
  const { cloud, setCloud, navigate } = useHeroDemoSession();
  const [query, setQuery] = useState('');
  const t = demoText(demo);
  const draft = cloud?.drafts[target];
  const config = draft ?? cloud?.uses.find(use => cloudSetupTarget(use) === target);
  if (!cloud || !config) return <div className="demo-module-content"><Button size="sm" tone="ghost" onClick={() => navigate('cloud')}>{t('返回云服务', 'Back to cloud services')}</Button></div>;
  const owner = ownerOptions(config.capability, t).find(o => o.id === config.owner);
  const connection = cloud.connections.find(c => c.id === config.connectionId);
  const available = connection ? modelsFor(connection.provider).filter(row => row.capabilities.includes(config.capability)) : [];
  const selected = available.find(row => row.id === config.model);
  const filtered = available.filter(row => (row.label + ' ' + row.id).toLowerCase().includes(query.trim().toLowerCase()));
  const updateDraft = (change: Partial<CloudUse>) => setCloud(old => old && ({
    ...old, drafts: { ...old.drafts, [target]: { ...(old.drafts[target] ?? config), ...change } },
  }));
  const back = () => navigate('cloud', connection?.id);
  const save = () => {
    if (!selected || !connection || connection.status === 'credential') return;
    setCloud(old => {
      if (!old) return old;
      const { [target]: usedDraft, ...drafts } = old.drafts;
      if (!usedDraft) return old;
      return { ...old, drafts, uses: [...old.uses.filter(use => use.owner !== usedDraft.owner || use.capability !== usedDraft.capability), usedDraft] };
    });
    back();
  };
  return <div className="demo-module-content cloud-setup">
    <Button size="sm" tone="ghost" onClick={back}><ArrowLeft size={15} />{t('返回云服务', 'Back to cloud services')}</Button>
    <h1>{t('模型设置', 'Model setup')}</h1>
    <p className="cloud-muted">{owner?.name} · {t('为这项能力选择云端模型', 'Choose a cloud model for this capability')} · {capabilityLabel(config.capability, demo)}</p>
    <div className="cloud-setup-card">
      <label className="cloud-field">{t('云服务', 'Cloud service')}<select value={connection?.id ?? ''} onChange={e => { updateDraft({ connectionId: e.target.value, model: '' }); setQuery(''); }}>
        {!connection && <option value="">{t('选择连接', 'Choose a connection')}</option>}
        {cloud.connections.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select></label>
      <h3>{t('选择模型', 'Choose a model')}</h3>
      {available.length > 5 && <SearchField value={query} onChange={e => setQuery(e.currentTarget.value)} onClear={() => setQuery('')} aria-label={t('搜索模型', 'Search models')} placeholder={t('搜索模型', 'Search models')} />}
      <div className="cloud-targets" role="group" aria-label={t('选择模型', 'Choose a model')}>
        {filtered.map(row => <button type="button" key={row.id} aria-pressed={selected?.id === row.id} onClick={() => updateDraft({ model: row.id })}>
          <Cloud size={16} /><span>{row.label}</span>{selected?.id === row.id && <Check size={16} />}
        </button>)}
        {!filtered.length && <p className="cloud-empty">{t("此连接没有匹配的模型。", "No matching models on this connection.")}</p>}
      </div>
      <p aria-live="polite">{!selected ? t('选择一个模型，确认后即可保存。', 'Choose a model, then confirm to save.') : draft
        ? t(`待保存：${selected.label}`, `Selected model: ${selected.label}`)
        : t(`已保存：${selected.label}`, `Saved model: ${selected.label}`)}</p>
      <small>{t("离开后会保留这份草稿。保存仅更新配置，不会发起 AI 请求；使用云服务时可能产生服务商费用。", "Leaving keeps this draft. Saving only updates the configuration and sends no AI request. Using cloud services may incur provider charges.")}</small>
      {connection?.status === 'credential' && <small>{t('该连接仍需要凭据。', 'This connection still needs a credential.')}</small>}
      <Button size="sm" tone="primary" disabled={!draft || !selected || !connection || connection.status === 'credential'} onClick={save}>
        {t(`保存到 ${owner?.name}`, `Save for ${owner?.name}`)}
      </Button>
    </div>
  </div>;
}
