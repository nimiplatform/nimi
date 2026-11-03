import { useState } from 'react';
import { Cloud, Plus, ShieldCheck } from 'lucide-react';
import { Button, SearchField } from '@nimiplatform/kit/ui';
import type { HeroDemo } from '../content/landing-content.js';
import { DemoNotice, DemoRow, DemoWorkspace, DemoServiceIcon, demoText } from './demo-home-ui.js';
import type { DemoNavigate } from './demo-home.js';

export function DemoCloudSurface({ demo, onNavigate }: { demo: HeroDemo; onNavigate: DemoNavigate }) {
  const t = demoText(demo);
  const connections = [
    { name: 'DeepSeek', host: 'api.deepseek.com', models: ['deepseek-chat', 'deepseek-reasoner'] },
    { name: 'DashScope', host: 'dashscope.aliyuncs.com', models: ['qwen-plus', 'qwen-turbo'] },
  ];
  const [selected, setSelected] = useState(0);
  const [query, setQuery] = useState('');
  const [modelQuery, setModelQuery] = useState('');
  const [tab, setTab] = useState('models');
  const [adding, setAdding] = useState(false);
  const [configure, setConfigure] = useState<string | null>(null);
  const connection = connections[selected]!;
  const tabs = [
    ['models', t('模型', 'Models')],
    ['apps', t('应用配置', 'App configuration')],
    ['usage', t('用量', 'Usage')],
  ];
  return (
    <DemoWorkspace
      title={demo.nav.cloud}
      sidebar={
        <>
          <p className="demo-muted px-4 mb-4">{t('我的连接（2）', 'My connections (2)')}</p>
          <div className="px-3 mb-3">
            <SearchField
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('搜索连接', 'Search connections')}
              aria-label={t('搜索连接', 'Search connections')}
            />
          </div>
          <div className="demo-sidebar-scroll">
            {connections.map(
              (item, index) =>
                item.name.toLowerCase().includes(query.toLowerCase()) && (
                  <DemoRow
                    key={item.name}
                    label={item.name}
                    detail={t('检查通过', 'Check passed')}
                    active={index === selected}
                    onClick={() => {
                      setSelected(index);
                      setConfigure(null);
                      setModelQuery('');
                      setAdding(false);
                    }}
                  >
                    <Cloud size={18} />
                  </DemoRow>
                ),
            )}
          </div>
          <div className="demo-sidebar-footer">
            <Button size="sm" onClick={() => setAdding(!adding)}>
              <Plus size={15} />
              {t('添加云服务', 'Add cloud service')}
            </Button>
          </div>
        </>
      }
    >
      <header className="demo-section-title">
        <h1>{adding ? t('添加云服务', 'Add cloud service') : connection.name}</h1>
        {!adding && <span className="demo-success">{t('检查通过', 'Check passed')}</span>}
      </header>
      {adding ? (
        <>
          <DemoNotice demo={demo} />
          <p className="demo-muted my-5">
            {t(
              '在 Nimi Home 中选择服务商并完成连接；凭据由本机 Runtime 管理。此演示不接收 API Key。',
              'Choose a provider and connect it in Nimi Home. The local Runtime manages credentials. This demo does not accept API keys.',
            )}
          </p>
          {connections.map((item, index) => (
            <DemoRow
              key={item.name}
              label={item.name}
              detail={item.host}
              onClick={() => {
                setSelected(index);
                setAdding(false);
              }}
            >
              <Cloud size={18} />
            </DemoRow>
          ))}
        </>
      ) : (
        <>
          <p className="demo-muted mt-2 mb-5">
            {connection.name} · {connection.host}
          </p>
          <div className="demo-status-band flex-wrap">
            <span>
              {t(
                '当前账户的连接。用量由服务商计费。',
                'Connected for the current account. Usage is billed by the provider.',
              )}
            </span>
            <details>
              <summary>{t('计费与数据说明', 'Billing & data')}</summary>
              <p className="mt-3">
                {t(
                  '使用云模型时，输入会发送到所选服务商。费用、数据处理和保留规则由服务商决定。',
                  'Cloud model inputs are sent to the selected provider. Its billing, data handling, and retention policies apply.',
                )}
              </p>
            </details>
          </div>
          <div className="demo-management-card mt-5">
            <div className="demo-tabs">
              {tabs.map(([id, label]) => (
                <button
                  type="button"
                  key={id}
                  aria-pressed={tab === id}
                  onClick={() => {
                    setTab(id!);
                    setConfigure(null);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            {tab === 'models' ? (
              <>
                <h2 className="my-4">{t('模型目录', 'Model catalog')} · 2</h2>
                <p className="demo-muted mb-4">
                  {t(
                    '选择模型，再为需要它的应用配置。',
                    'Choose a model, then configure it for the apps that need it.',
                  )}
                </p>
                <SearchField
                  value={modelQuery}
                  onChange={(event) => setModelQuery(event.target.value)}
                  placeholder={t('搜索模型或能力', 'Search models or capabilities')}
                  aria-label={t('搜索模型或能力', 'Search models or capabilities')}
                />
                {connection.models
                  .filter((name) => name.includes(modelQuery.trim().toLowerCase()))
                  .map((name) => (
                    <div key={name} className="demo-setting-row">
                      <div>
                        <strong>{name}</strong>
                        <small>{t('文本生成', 'Text generation')}</small>
                      </div>
                      <Button
                        tone="secondary"
                        size="sm"
                        onClick={() => setConfigure(configure === name ? null : name)}
                      >
                        {t('配置到应用', 'Configure for app')}
                      </Button>
                    </div>
                  ))}
                {configure && (
                  <div className="demo-status-band mt-3 flex-col items-start">
                    <h3>{configure}</h3>
                    <p>
                      {t(
                        '选择应用，查看它自己的 AI 配置。',
                        'Choose an app to view its own AI configuration.',
                      )}
                    </p>
                    <div className="demo-actions">
                      {demo.apps.items.slice(0, 3).map((app) => (
                        <Button
                          key={app.id}
                          size="sm"
                          tone="secondary"
                          onClick={() => onNavigate('apps', app.id)}
                        >
                          {app.name}
                        </Button>
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : tab === 'apps' ? (
              <>
                {demo.apps.items.slice(0, 2).map((app) => (
                  <DemoRow
                    key={app.id}
                    label={app.name}
                    detail={connection.models[0]}
                    onClick={() => onNavigate('apps', app.id)}
                  />
                ))}
              </>
            ) : (
              <>
                <h2 className="mt-5">{t('今日用量', 'Today’s usage')}</h2>
                <div className="demo-setting-row">
                  <span>{t('已记录请求', 'Recorded requests')}</span>
                  <strong>8</strong>
                </div>
                <div className="demo-setting-row">
                  <span>{t('输入 / 输出 Token', 'Input / output tokens')}</span>
                  <strong>2,480 / 1,120</strong>
                </div>
                <p className="demo-muted">
                  {t('费用以服务商账单为准。', 'Refer to your provider’s bill for charges.')}
                </p>
              </>
            )}
          </div>
        </>
      )}
    </DemoWorkspace>
  );
}

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
