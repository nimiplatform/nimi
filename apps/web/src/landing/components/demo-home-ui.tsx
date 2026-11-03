import type { ReactNode } from 'react';
import { Button } from '@nimiplatform/kit/ui';
import { ArrowLeft, Blocks, ChevronRight } from 'lucide-react';
import type { HeroDemo } from '../content/landing-content.js';

export function demoText(demo: HeroDemo) {
  return (zh: string, en: string) => (demo.appPreview.locale === 'zh' ? zh : en);
}

export function DemoSectionTitle({
  title,
  action,
  onAction,
}: {
  title: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <div className="demo-section-title">
      <h2>{title}</h2>
      {action && (
        <Button tone="ghost" size="sm" onClick={onAction}>
          {action}
        </Button>
      )}
    </div>
  );
}

export function DemoWorkspace({
  title,
  sidebar,
  children,
}: {
  title: string;
  sidebar: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="demo-workspace" aria-label={title}>
      <aside className="demo-module-sidebar">
        <h2>{title}</h2>
        {sidebar}
      </aside>
      <section className="demo-module-content">{children}</section>
    </div>
  );
}

export function DemoRow({
  label,
  detail,
  active,
  onClick,
  children,
}: {
  label: string;
  detail?: string;
  active?: boolean;
  onClick: () => void;
  children?: ReactNode;
}) {
  return (
    <button type="button" className="demo-module-row" aria-pressed={active} onClick={onClick}>
      {children}
      <span>
        <strong>{label}</strong>
        {detail && <small>{detail}</small>}
      </span>
      <ChevronRight size={14} className="ml-auto shrink-0 opacity-40" />
    </button>
  );
}

export function DemoBack({ demo, onClick }: { demo: HeroDemo; onClick: () => void }) {
  return (
    <Button size="sm" tone="ghost" onClick={onClick}>
      <ArrowLeft size={14} />
      {demo.home.back}
    </Button>
  );
}

export function DemoNotice({ demo }: { demo: HeroDemo }) {
  return <p className="demo-simulation-note">{demo.home.note}</p>;
}

export function DemoPartnerAvatar({ index, name, src }: { index: number; name: string; src?: string }) {
  const assets = ['qingzhao', 'wanxing', 'xiake'];
  return (
    <img
      className="demo-partner-avatar"
      src={src ?? `/demo/zhiyu/${assets[index % assets.length]}-avatar.svg`}
      alt={name}
    />
  );
}

export function DemoServiceIcon({ id, large = false }: { id: string; large?: boolean }) {
  const logos: Record<string, string> = {
    feishu: 'feishu.svg',
    wechat: 'weixin.png',
    qq: 'qq-official.png',
    telegram: 'telegram.svg',
    mcp: 'mcp.svg',
    onebot: 'onebot-v11.png',
  };
  return (
    <span className={large ? 'demo-service-icon' : 'demo-service-glyph'}>
      {logos[id] ? (
        <img src={`/demo/integration-logos/${logos[id]}`} alt="" />
      ) : (
        <Blocks size={large ? 28 : 20} />
      )}
    </span>
  );
}
