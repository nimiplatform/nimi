import { useState } from 'react';
import {
  AudioLines,
  CheckCircle2,
  ChevronRight,
  Cpu,
  FileBox,
  Image,
  MessageSquare,
  Mic,
  SlidersHorizontal,
} from 'lucide-react';
import { Button } from '@nimiplatform/kit/ui';
import type { HeroDemo } from '../content/landing-content.js';
import type { DemoNavigate } from './demo-home.js';
import { DemoBack, DemoNotice, DemoRow, DemoWorkspace, demoText } from './demo-home-ui.js';

// @nimi-authority: rule.nimi.desktop.ai-consumption.capability-workspace
export function DemoRuntimeSurface({ demo, onNavigate }: { demo: HeroDemo; onNavigate: DemoNavigate }) {
  const c = demo.home;
  const t = demoText(demo);
  const [selected, setSelected] = useState<string | null>(null);
  const [section, setSection] = useState<'overview' | 'files' | 'saved'>('overview');
  const [config, setConfig] = useState(false);
  const capability = c.capabilities.find((item) => item.id === selected);
  const ready = c.capabilities.filter((item) => item.ready);
  const icons = [MessageSquare, Image, AudioLines, Mic];
  return (
    <DemoWorkspace
      title={demo.nav.runtime}
      sidebar={
        <>
          <p className="demo-muted px-4 pb-4">{t('4 项可用', '4 ready')}</p>
          <div className="demo-sidebar-scroll">
            {c.capabilityGroups.map((group, index) => (
              <div key={group}>
                <p className="demo-sidebar-label">{group}</p>
                {c.capabilities
                  .filter((item) => item.group === index)
                  .map((item) => (
                    <DemoRow
                      key={item.id}
                      label={item.label}
                      detail={item.ready ? item.model : c.unset}
                      active={selected === item.id}
                      onClick={() => {
                        setSelected(item.id);
                        setConfig(false);
                      }}
                    >
                      <i className={item.ready ? 'demo-status-dot' : 'demo-unset-dot'} />
                    </DemoRow>
                  ))}
              </div>
            ))}
          </div>
          <div className="demo-sidebar-footer">
            <DemoRow
              label={t('管理模型文件', 'Manage model files')}
              onClick={() => {
                setSelected(null);
                setSection('files');
              }}
            />
            <DemoRow label={c.diagnostics} onClick={() => onNavigate('diagnostics')}>
              <SlidersHorizontal size={15} />
            </DemoRow>
          </div>
        </>
      }
    >
      {capability ? (
        <>
          <DemoBack demo={demo} onClick={() => setSelected(null)} />
          <h1>{capability.label}</h1>
          <p className="demo-muted my-3">
            {capability.description ??
              t('在支持此能力的应用中使用。', 'Use this capability in supported apps.')}
          </p>
          <div className="demo-status-band">
            <i className={capability.ready ? 'demo-status-dot' : 'demo-unset-dot'} />
            {capability.ready ? t('已就绪', 'Ready') : c.unset}
          </div>
          <h2 className="mt-6 mb-3">{t('模型', 'Models')}</h2>
          <div className="demo-management-card">
            <div className="demo-section-title">
              <span className="demo-model-icon">
                <Cpu size={23} />
              </span>
              <div className="min-w-0 flex-1">
                <h2>{capability.model || t('暂无本机模型', 'No local model')}</h2>
                <p className="demo-muted">
                  {capability.ready
                    ? t('本机当前模型', 'Current local model')
                    : t('尚未准备', 'Not prepared')}
                </p>
              </div>
              {capability.model && (
                <Button tone="secondary" size="sm" onClick={() => setConfig(!config)}>
                  {t('设置', 'Settings')}
                </Button>
              )}
            </div>
            {capability.size && (
              <p className="demo-muted mt-4">
                {capability.size} · {t('模型文件已在本机', 'Model files on this device')}
              </p>
            )}
            {config && (
              <div className="mt-4 border-t border-slate-200 pt-4">
                <h3>{t('模型配置', 'Model configuration')}</h3>
                <p className="demo-muted mt-2">
                  {capability.model} · {t('本地', 'Local')}
                </p>
                <DemoNotice demo={demo} />
              </div>
            )}
          </div>
          <p className="demo-muted my-4">
            {t(
              '切换后，使用本机模型的应用会改用新模型，应用自己的专属设置会保留。需要下载或安装时，会先请你确认。',
              'Changing the local model updates apps using it while preserving app-specific settings. Downloads or installations require confirmation.',
            )}
          </p>
          <Button
            tone="ghost"
            size="sm"
            onClick={() => {
              setSelected(null);
              setSection('saved');
            }}
          >
            {t('管理保存的配置', 'Manage saved configurations')}
          </Button>
          <h2 className="mt-6 mb-3">{t('使用此能力的应用', 'Apps using this capability')}</h2>
          <div className="demo-actions">
            {demo.apps.items.slice(0, 4).map((app) => (
              <Button tone="secondary" size="sm" key={app.id} onClick={() => onNavigate('apps', app.id)}>
                {app.name}
              </Button>
            ))}
          </div>
        </>
      ) : (
        <>
          {section !== 'overview' && <DemoBack demo={demo} onClick={() => setSection('overview')} />}
          <h1>
            {section === 'files'
              ? t('本机模型与资源', 'Local models & resources')
              : section === 'saved'
                ? t('已保存的配置', 'Saved configurations')
                : c.overview}
          </h1>
          {section === 'overview' && (
            <>
              <section className="demo-ready-panel">
                <h2>
                  <i className="demo-status-dot" />
                  {t('可用能力 · 4', 'Available capabilities · 4')}
                </h2>
                <div className="demo-capability-grid">
                  {ready.map((item, index) => {
                    const Icon = icons[index]!;
                    return (
                      <button key={item.id} type="button" onClick={() => setSelected(item.id)}>
                        <span className="demo-model-icon">
                          <Icon size={23} />
                        </span>
                        <span>
                          <strong>{item.model}</strong>
                          <small>{item.label}</small>
                        </span>
                        <ChevronRight size={16} />
                      </button>
                    );
                  })}
                </div>
              </section>
              <div className="demo-section-title my-5">
                <h2>{t('AI 配置方案', 'AI configurations')}</h2>
              </div>
              <button
                type="button"
                className="demo-management-card demo-config-card"
                onClick={() => setSection('saved')}
              >
                <FileBox size={24} />
                <span>
                  <strong>{t('日常创作配置', 'Everyday creativity')}</strong>
                  <small>
                    {t(
                      '文本生成 · 图像生成 · 语音合成 · 语音转写',
                      'Text · Images · Speech synthesis · Transcription',
                    )}
                  </small>
                </span>
                <ChevronRight size={16} />
              </button>
            </>
          )}
          <h2 className="mt-6 mb-4">
            {section === 'saved'
              ? t('日常创作配置', 'Everyday creativity')
              : t('本机模型与资源', 'Local models & resources')}{' '}
            <span className="demo-muted">4</span>
          </h2>
          {ready.map((item) => (
            <button
              key={item.id}
              type="button"
              className="demo-model-file"
              onClick={() => setSelected(item.id)}
            >
              <span className="demo-model-icon">
                <FileBox size={20} />
              </span>
              <span>
                <strong>{item.model}</strong>
                <small>
                  {item.label} · {item.size}
                </small>
              </span>
              <CheckCircle2 size={17} className="text-green-600" />
              <ChevronRight size={15} />
            </button>
          ))}
        </>
      )}
    </DemoWorkspace>
  );
}
