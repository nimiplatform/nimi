import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Avatar, Popover, PopoverContent, PopoverTrigger } from '@nimiplatform/kit/ui';
import { useAgentIntroduction } from '@nimiplatform/kit/features/chat/runtime';
import { agentIntroductionDisplayText } from '@nimiplatform/kit/features/chat/headless';
import type { NimiLocalAppAgentHandle, NimiLocalAppAgentIntroductionClient } from '@nimiplatform/sdk/app';
import { ArrowRight, Globe, Pause, Play } from 'lucide-react';

type Props = {
  agentHandle: NimiLocalAppAgentHandle | null;
  name: string;
  avatarUrl: string | null;
  placement: 'composer' | 'rail';
  readIntroduction: NimiLocalAppAgentIntroductionClient['getIntroduction'];
  onSelect?: () => void;
  onOpen: (section: 'overview' | 'cognition') => void;
  children: ReactElement;
};

// @nimi-authority: rule.nimi.zhiyu.local-partner-surface.r014
// @nimi-authority: rule.nimi.zhiyu.local-partner-surface.agent-introduction
export function ZhiyuPartnerAvatarCard(props: Props) {
  return props.agentHandle ? <PartnerPreview key={props.agentHandle} {...props} /> : props.children;
}

function PartnerPreview({ agentHandle, name, avatarUrl, placement, readIntroduction, onSelect, onOpen, children }: Props) {
  const [open, setOpen] = useState(false);
  const { introduction, loading, unavailable, retry } = useAgentIntroduction({ agentHandle: open ? agentHandle : null, getIntroduction: readIntroduction });
  const trigger = useRef<HTMLButtonElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const keyboardEntry = useRef(false);
  const restoreFocus = useRef(false);
  const dismissed = useRef(false);
  const cancel = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; };
  const enter = () => { if (keyboardEntry.current && content.current?.isConnected) { content.current.focus(); keyboardEntry.current = false; } };
  const schedule = (next: boolean) => {
    cancel();
    if (next && dismissed.current) return;
    timer.current = setTimeout(() => { if (next || !content.current?.contains(document.activeElement)) setOpen(next); }, next ? 180 : 200);
  };
  useEffect(() => { if (!open) cancel(); }, [open]);
  useEffect(() => () => cancel(), []);
  const image = introduction?.referenceImageUrl;
  const topics = introduction?.questionTopics.filter(topic => topic.kind === 'topic' || topic.kind === 'work').slice(-3) ?? [];
  const go = (section: 'overview' | 'cognition') => { setOpen(false); onOpen(section); };
  return <Popover open={open} onOpenChange={next => { cancel(); if (!next) dismissed.current = true; setOpen(next); }}>
    <PopoverTrigger asChild ref={trigger}
      onMouseEnter={() => { dismissed.current = false; schedule(true); }} onMouseLeave={() => { dismissed.current = false; schedule(false); }}
      onFocus={() => schedule(true)} onBlur={() => { dismissed.current = false; schedule(false); }}
      onKeyDown={event => {
        if (event.key === 'ArrowDown') { event.preventDefault(); cancel(); dismissed.current = false; keyboardEntry.current = true; setOpen(true); enter(); }
        if (event.key === 'Escape') { event.preventDefault(); cancel(); dismissed.current = true; setOpen(false); }
      }}
      onClick={event => { event.preventDefault(); cancel(); dismissed.current = false; if (placement === 'rail') { setOpen(false); onSelect?.(); } else setOpen(true); }}>
      {children}
    </PopoverTrigger>
    <PopoverContent side={placement === 'rail' ? 'right' : 'top'} align={placement === 'rail' ? 'center' : 'start'} sideOffset={10}
      className="zhiyu-partner-preview" onMouseEnter={cancel} onMouseLeave={() => schedule(false)}
      onOpenAutoFocus={event => { event.preventDefault(); enter(); }}
      onCloseAutoFocus={event => { event.preventDefault(); if (restoreFocus.current) { trigger.current?.focus(); cancel(); restoreFocus.current = false; } }}>
      <div ref={node => { content.current = node; enter(); }} tabIndex={-1} aria-label={`${name}的伙伴资料`} data-testid="zhiyu-partner-card"
        className={`zhiyu-partner-preview__layout${image ? '' : ' is-compact'}`}
        onFocusCapture={cancel} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) schedule(false); }}
        onKeyDownCapture={event => { if (event.key === 'Escape') { dismissed.current = true; restoreFocus.current = true; } }}>
        {image ? <div className="zhiyu-partner-preview__art"><img src={image} alt={name} referrerPolicy="no-referrer" /></div> : null}
        <div className="zhiyu-partner-preview__copy">
          {!image ? <Avatar src={avatarUrl} alt={name} size="md" /> : null}
          <h3>{name}</h3>
          {introduction?.era ? <p className="zhiyu-partner-preview__muted">{agentIntroductionDisplayText(introduction.era, 'zh-CN')}</p> : null}
          {introduction?.voicePreviewUrl ? <VoicePreview key={introduction.voicePreviewUrl} src={introduction.voicePreviewUrl} duration={introduction.voiceSampleDurationSec} active={open} /> : null}
          {introduction?.role ? <p className="zhiyu-partner-preview__intro">{agentIntroductionDisplayText(introduction.role, 'zh-CN')}</p> : null}
          {introduction?.worldName ? <p className="zhiyu-partner-preview__world"><Globe size={14} aria-hidden />{introduction.worldName}</p> : null}
          {topics.length ? <div className="zhiyu-partner-preview__topics"><ul>{topics.map(topic => <li key={`${topic.kind}:${topic.text}`}>{agentIntroductionDisplayText(topic.text, 'zh-CN')}</li>)}</ul></div> : null}
          {loading ? <p role="status" className="zhiyu-partner-preview__muted">正在读取介绍…</p> : null}
          {unavailable ? <p role="status" className="zhiyu-partner-preview__muted">人物介绍暂时无法加载。<button type="button" onClick={retry}>重试</button></p> : null}
          <div className="zhiyu-partner-preview__actions">
            <button type="button" onClick={() => go('overview')}>伙伴中心<ArrowRight size={16} aria-hidden /></button>
            <button type="button" onClick={() => go('cognition')}>记忆</button>
          </div>
        </div>
      </div>
    </PopoverContent>
  </Popover>;
}

function VoicePreview({ src, duration, active }: { src: string; duration: number | null; active: boolean }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => { const node = audio.current; if (!active) node?.pause(); return () => { node?.pause(); }; }, [active]);
  return <div className="zhiyu-partner-preview__voice">
    <audio ref={audio} src={src} preload="none" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} />
    <button type="button" aria-pressed={playing} onClick={() => {
      const node = audio.current;
      if (!active || !node) return;
      setFailed(false);
      if (node.paused) void node.play().then(() => { if (!node.isConnected) node.pause(); }).catch(() => setFailed(true));
      else node.pause();
    }}><span>{playing ? <Pause size={12} aria-hidden /> : <Play size={12} aria-hidden />}</span>{playing ? '暂停试听' : '听听声音'}{duration ? <small>· {Math.round(duration)}秒</small> : null}</button>
    {failed ? <p role="status">声音暂时无法播放，请重试。</p> : null}
  </div>;
}
