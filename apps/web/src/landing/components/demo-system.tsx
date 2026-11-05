import { useState } from 'react';
import { CheckCircle2, FileBox } from 'lucide-react';
import { Button } from '@nimiplatform/kit/ui';
import type { HeroDemo } from '../content/landing-content.js';
import type { DemoNavigate } from './demo-home.js';
import { demoText } from './demo-home-ui.js';

export function DemoDownloadsSurface({ demo, onNavigate }: { demo: HeroDemo; onNavigate: DemoNavigate }) {
  const t = demoText(demo);
  const [tab, setTab] = useState('all');
  return (
    <div className="demo-simple-page">
      <h1>{demo.nav.downloads}</h1>
      <div className="demo-tabs my-5">
        {[
          ['all', demo.home.all],
          ['active', t('进行中', 'In progress')],
          ['completed', t('已完成', 'Completed')],
        ].map(([id, label]) => (
          <button key={id} type="button" aria-pressed={tab === id} onClick={() => setTab(id!)}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'active' ? (
        <p className="demo-empty">{t('没有进行中的下载', 'No downloads in progress')}</p>
      ) : (
        demo.home.capabilities
          .filter((item) => item.ready)
          .map((item) => (
            <div key={item.id} className="demo-management-card demo-download-item">
              <FileBox size={24} />
              <div className="flex-1">
                <h2>{item.model}</h2>
                <p className="demo-muted mt-1">
                  {item.size} · {item.label}
                </p>
              </div>
              <CheckCircle2 size={16} className="text-green-600" />
              <span>{t('已完成', 'Completed')}</span>
              <Button tone="ghost" size="sm" onClick={() => onNavigate('runtime')}>
                {t('查看', 'View')}
              </Button>
            </div>
          ))
      )}
    </div>
  );
}
export function DemoDiagnosticsSurface({ demo }: { demo: HeroDemo }) {
  const t = demoText(demo);
  const [tab, setTab] = useState('services');
  return (
    <div className="demo-simple-page">
      <h1>{demo.home.diagnostics}</h1>
      <div className="demo-tabs my-5">
        {[
          ['services', t('服务状态', 'Services')],
          ['usage', t('AI 执行记录', 'AI activity')],
        ].map(([id, label]) => (
          <button key={id} type="button" aria-pressed={tab === id} onClick={() => setTab(id!)}>
            {label}
          </button>
        ))}
      </div>
      <div className="demo-management-card">
        {tab === 'services' ? (
          <>
            <h2>{demo.home.runtimeOK}</h2>
            {[
              ['CPU', '8%'],
              [t('内存', 'Memory'), '42%'],
              [t('磁盘', 'Disk'), '28%'],
            ].map(([label, value]) => (
              <div key={label} className="demo-setting-row">
                <span>{label}</span>
                <strong>{value}</strong>
              </div>
            ))}
          </>
        ) : (
          <>
            <h2>{demo.home.usage}</h2>
            {demo.home.capabilities
              .filter((item) => item.ready)
              .map((item) => (
                <div key={item.id} className="demo-setting-row">
                  <div>
                    <strong>{item.label}</strong>
                    <small>{item.model}</small>
                  </div>
                  <span>{t('完成', 'Completed')}</span>
                </div>
              ))}
          </>
        )}
      </div>
    </div>
  );
}
