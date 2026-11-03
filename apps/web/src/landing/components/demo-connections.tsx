import { useState } from 'react';
import { Plus, ShieldCheck } from 'lucide-react';
import { Button, SearchField } from '@nimiplatform/kit/ui';
import type { HeroDemo } from '../content/landing-content.js';
import { DemoNotice, DemoRow, DemoWorkspace, DemoServiceIcon, demoText } from './demo-home-ui.js';

export function DemoIntegrationsSurface({ demo, target }: { demo: HeroDemo; target?: string }) {
  const t = demoText(demo);
  const [id, setId] = useState(target ?? 'telegram');
  const [tab, setTab] = useState('permissions');
  const [query, setQuery] = useState('');
  const [details, setDetails] = useState(false);
  const item = demo.home.integrations.find((item) => item.id === id)!;
  const tabs = [
    ['permissions', t('应用授权', 'App permissions')],
    ['usage', t('使用记录', 'Usage history')],
    ['connection', t('连接信息', 'Connection details')],
  ];
  return (
    <DemoWorkspace
      title={demo.nav.integrations}
      sidebar={
        <>
          <p className="demo-muted px-4 mb-4">{t('7 类服务', '7 service types')}</p>
          <div className="px-3 mb-3">
            <SearchField
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('搜索服务', 'Search services')}
              aria-label={t('搜索服务', 'Search services')}
            />
          </div>
          <div className="demo-sidebar-scroll">
            {demo.home.integrations
              .filter((item) => item.name.toLowerCase().includes(query.toLowerCase()))
              .map((item) => (
                <DemoRow
                  key={item.id}
                  label={item.name}
                  detail={item.connections ? String(item.connections) : undefined}
                  active={id === item.id}
                  onClick={() => {
                    setId(item.id);
                    setDetails(false);
                  }}
                >
                  <DemoServiceIcon id={item.id} />
                </DemoRow>
              ))}
          </div>
        </>
      }
    >
      <div className="demo-section-title">
        <h1>{item.name}</h1>
        <Button size="sm" tone="secondary" onClick={() => setDetails(!details)}>
          <Plus size={14} />
          {t('添加连接', 'Add connection')}
        </Button>
      </div>
      {details && (
        <div className="demo-management-card my-4">
          <h2>{t('连接此服务', 'Connect this service')}</h2>
          <DemoNotice demo={demo} />
          <p className="demo-muted mt-3">
            {t(
              '在 Nimi Home 中添加连接后，再选择允许使用此连接的应用与操作。',
              'After connecting in Nimi Home, choose which apps and operations may use this connection.',
            )}
          </p>
        </div>
      )}
      <div className="demo-status-band my-5">
        {t('当前连接', 'Current connection')}{' '}
        <strong>
          {item.connections
            ? `${item.name} · ${t('个人工作区', 'Personal workspace')}`
            : t('未连接', 'Not connected')}
        </strong>
        {item.connections > 0 && <span className="demo-success">{demo.home.ready}</span>}
      </div>
      <div className="demo-tabs">
        {tabs.map(([id, label]) => (
          <button type="button" key={id} aria-pressed={tab === id} onClick={() => setTab(id!)}>
            {label}
          </button>
        ))}
      </div>
      <section className="demo-management-card mt-5">
        {tab === 'permissions' ? (
          <>
            <h2>
              <ShieldCheck size={18} className="inline mr-2" />
              {t('已授权应用', 'Authorized apps')}
            </h2>
            {item.connections ? (
              <div className="demo-setting-row">
                <strong>{item.id === 'telegram' ? 'ParentOS' : 'Jev Ultrafast'}</strong>
                <span className="demo-chip">
                  {item.id === 'telegram' ? 'telegram.sendMessage' : t('读取工具列表', 'Read tool list')}
                </span>
              </div>
            ) : (
              <p className="demo-empty">
                {t('连接服务后，可为应用授权。', 'Connect the service to authorize apps.')}
              </p>
            )}
          </>
        ) : tab === 'usage' ? (
          <>
            <h2>{t('使用记录', 'Usage history')}</h2>
            {item.connections ? (
              <div className="demo-setting-row">
                <div>
                  <strong>{t('读取连接状态', 'Read connection status')}</strong>
                  <small>14:20 · {t('示例记录', 'Sample record')}</small>
                </div>
                <span className="demo-success">{t('完成', 'Completed')}</span>
              </div>
            ) : (
              <p className="demo-empty">{t('暂无记录', 'No records')}</p>
            )}
          </>
        ) : (
          <>
            <h2>{t('连接信息', 'Connection details')}</h2>
            <div className="demo-setting-row">
              <span>{t('服务', 'Service')}</span>
              <strong>{item.name}</strong>
            </div>
            <div className="demo-setting-row">
              <span>{t('凭据', 'Credentials')}</span>
              <span>{t('由本机 Runtime 管理', 'Managed by local Runtime')}</span>
            </div>
            <DemoNotice demo={demo} />
          </>
        )}
      </section>
    </DemoWorkspace>
  );
}
