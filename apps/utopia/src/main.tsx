import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { createNimiClient } from '@nimiplatform/sdk';
import type { NimiUtopiaFrame, NimiUtopiaResident, NimiUtopiaSettingsIntent, NimiUtopiaSnapshot, NimiUtopiaTime } from '@nimiplatform/sdk/app';
import { createNimiLocalAppStandardShellSurface } from '@nimiplatform/kit/shell/renderer/bridge';
import { createAppConversationEntrySession, createBrowserAppConversationHostPort, type AppConversationEntryState } from '@nimiplatform/kit/features/chat/headless';
import './styles.css';

const client = createNimiClient({ localApp: { standardShell: createNimiLocalAppStandardShellSurface() } });
const placeName: Record<string, string> = {
  'bird-hide': '观鸟棚', 'island-deck': '海边平台', workshop: '工作间', 'observation-window': '室内观测窗', 'outdoor-platform': '室外平台',
};
const activityName: Record<string, string> = { 'observe-snow': '观察风雪', 'watch-birds': '观鸟', 'watch-waves': '看海浪', organize: '整理物品', sketch: '画画', read: '阅读' };
const stateName: Record<string, string> = {
  invited: '已发出邀请', accepted: '已接受，等待开始', active: '正在共同参与', completed: '已发生',
  declined: '已婉拒', expired: '邀请已过期', invalidated: '安排已失效', missed: '未发生', interrupted: '已中止',
  unanswered: '未回应', unavailable: '回应未能完成',
};

function describe(frame: NimiUtopiaFrame | null) {
  if (!frame) return '—';
  if (frame.interaction) return '互动或工作中';
  const title = frame.title === 'Activity' ? '日常活动' : activityName[frame.title] ?? frame.title;
  return frame.place ? `${title} · ${placeName[frame.place] ?? frame.place}` : title;
}

function LocalTime({ value }: { value: NimiUtopiaTime }) {
  const time = new Date(Number(value.seconds) * 1000 + Math.floor(value.nanos / 1_000_000));
  return <time dateTime={time.toISOString()}>{time.toLocaleString('zh-CN', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })}</time>;
}

type ChatTarget = { resident: NimiUtopiaResident; draft: string };

function Conversation({ target, close }: { target: ChatTarget; close: () => void }) {
  const session = useMemo(() => createAppConversationEntrySession({ client, hostPort: createBrowserAppConversationHostPort() }), []);
  const [state, setState] = useState<AppConversationEntryState>(() => session.getState());
  const [draft, setDraft] = useState(target.draft);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    const remove = session.observe(setState);
    void session.loadReferences().then(() => { if (active) return session.selectReference(target.resident.agentHandle); });
    return () => { active = false; remove(); void session.dispose(); };
  }, [session, target.resident.agentHandle]);

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setError('');
    try {
      await session.send({ requestId: `utopia-${crypto.randomUUID()}`, parts: [{ kind: 'text', text }] });
      setDraft(current => current.trim() === text ? '' : current);
    } catch {
      setError('消息未获确认，请在对话中核对后重试。');
    } finally { setSending(false); }
  }

  return <section className="panel conversation" aria-label={`与${target.resident.displayName}对话`}>
    <div className="row"><h2>{target.resident.displayName}</h2><button onClick={close}>关闭对话</button></div>
    {state.error && <p role="alert">对话暂不可用。{state.error}</p>}
    <ol className="messages" aria-live="polite">
      {state.messages.map(message => <li key={message.id}><strong>{message.role === 'user' ? '你' : target.resident.displayName}</strong><p>{message.text}</p></li>)}
    </ol>
    <form onSubmit={send}>
      <label htmlFor="chat-draft">消息</label>
      <textarea id="chat-draft" value={draft} onChange={event => setDraft(event.currentTarget.value)} />
      {error && <p role="alert">{error}</p>}
      <button disabled={sending || !draft.trim() || state.status !== 'ready' || !!state.activeTurnId}>{sending ? '发送中…' : '发送'}</button>
    </form>
  </section>;
}

function Utopia() {
  const [snapshot, setSnapshot] = useState<NimiUtopiaSnapshot | null>(null);
  const [chat, setChat] = useState<ChatTarget | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const request = useRef(0);
  const refresh = useCallback(async () => {
    const id = ++request.current;
    try {
      const value = await client.utopia.snapshot();
      if (id === request.current) { setSnapshot(value); setError(''); }
    } catch (failure) {
      if (id !== request.current) return;
      const code = failure && typeof failure === 'object' && 'reasonCode' in failure ? String(failure.reasonCode).toLowerCase().replaceAll('_', '-') : '';
      if (/account-changed|session-invalid|access-denied|runtime-unauthenticated|revoked|runtime-restarted/u.test(code)) {
        setSnapshot(null);
        setChat(null);
      }
      setError('暂时无法读取住地。请确认 Nimi Home 已登录。');
    }
  }, []);
  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, 30_000);
    window.addEventListener('focus', refresh);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [refresh]);

  async function update(intent: NimiUtopiaSettingsIntent) {
    if (!snapshot || busy) return;
    setBusy(true);
    setError('');
    try {
      await client.utopia.update({ expectedRevision: snapshot.settings.revision, intent });
      await refresh();
    } catch (failure) {
      const reason = failure && typeof failure === 'object' && 'reasonCode' in failure ? String(failure.reasonCode) : '';
      if (reason.toLowerCase().replaceAll('_', '-').includes('utopia-revision-conflict')) {
        await refresh();
        setError('住地设置已在别处更新。请按当前设置重试。');
      } else { setError('未保存设置。请确认当前 App 获准管理住地。'); }
    } finally { setBusy(false); }
  }

  const name = (handle: string) => snapshot?.residents.find(resident => resident.agentHandle === handle)?.displayName ?? '伙伴';
  return <main>
    <header className="row heading"><h1>我的乌托邦</h1><button onClick={() => void refresh()}>刷新</button></header>
    {error && <p className="alert" role="alert">{error}</p>}
    {!snapshot && !error && <p role="status">正在读取住地…</p>}
    {snapshot && <>
      <section className="panel" aria-labelledby="utopia-title">
        <div className="row"><h2 id="utopia-title">住地</h2><small>最近确认 {new Date(Number(snapshot.observedAt.seconds) * 1000).toLocaleTimeString('zh-CN')}</small></div>
        <div className="settings">
          <label>环境 <select disabled={busy} value={snapshot.settings.preset} onChange={event => void update({ kind: 'select-preset', preset: event.currentTarget.value === 'island' ? 'island' : 'polar-station' })}>
            <option value="island">海边小岛</option><option value="polar-station">极地科考站</option>
          </select></label>
          <label><input type="checkbox" disabled={busy} checked={snapshot.settings.outdoorOpen} onChange={event => void update({ kind: 'outdoor', open: event.currentTarget.checked })} /> 开放露天场所</label>
          <label><input type="checkbox" disabled={busy} checked={snapshot.settings.publicParticipation} onChange={event => void update({ kind: 'public', enabled: event.currentTarget.checked })} /> 允许伙伴参与公共活动</label>
          <button disabled={busy} onClick={() => void update({ kind: 'restore-default' })}>恢复默认环境</button>
        </div>
        <ul className="places">{snapshot.places.map(place => <li key={place.id}>
          <strong>{placeName[place.id] ?? place.id}</strong><span>{place.activities.map(activity => activityName[activity] ?? activity).join('、')}</span>
          {snapshot.occupancy.filter(value => value.place === place.id).map(value => <span key={value.place}>{value.agentHandles.map(name).join('、')} 在这里</span>)}
        </li>)}</ul>
      </section>
      <section aria-labelledby="residents-title"><h2 id="residents-title">伙伴</h2>
        {snapshot.residents.length === 0 && <p>在 Nimi Home 为伙伴开启自主生活后，这里会显示他们的近况。</p>}
        <div className="residents">{snapshot.residents.map(resident => {
          const shared = snapshot.sharedActivities.find(activity => activity.state === 'active'
            && (activity.initiatorHandle === resident.agentHandle || activity.recipientHandle === resident.agentHandle));
          const current = shared
            ? `共同${activityName[shared.activity] ?? shared.activity} · ${placeName[shared.place] ?? shared.place}`
            : describe(resident.current);
          return <article className="panel" key={resident.agentHandle}>
            <div className="row"><h3>{resident.displayName}</h3><button onClick={() => setChat({ resident, draft: '' })}>聊天</button></div>
            <dl><div><dt>现在</dt><dd>{current}</dd></div><div><dt>刚刚</dt><dd>{describe(resident.recent)}</dd></div><div><dt>接下来</dt><dd>{describe(resident.next)}</dd></div></dl>
            <label><input type="checkbox" checked={resident.solitary} disabled={busy || !snapshot.settings.publicParticipation} onChange={event => void update({ kind: 'solitude', agentHandle: resident.agentHandle, solitary: event.currentTarget.checked })} /> 独处</label>
          </article>;
        })}</div>
      </section>
      {snapshot.sharedActivities.length > 0 && <section className="panel" aria-labelledby="shared-title">
        <h2 id="shared-title">共同活动</h2>
        <ul className="shared">{snapshot.sharedActivities.map(activity => {
          const resident = snapshot.residents.find(item => item.agentHandle === activity.initiatorHandle);
          const text = `${name(activity.initiatorHandle)} 和 ${name(activity.recipientHandle)} · ${activityName[activity.activity] ?? activity.activity}`;
          const status = activity.state === 'missed' && activity.acceptedAt ? '已接受，活动未发生' : stateName[activity.state] ?? activity.state;
          const showTime = ['accepted', 'active', 'completed', 'interrupted'].includes(activity.state);
          return <li key={activity.activityRef} className="row"><div><strong>{text}</strong><p>{status} · {placeName[activity.place] ?? activity.place}</p>
            {showTime && activity.startsAt && <small><LocalTime value={activity.startsAt} />{activity.endsAt && <> 至 <LocalTime value={activity.endsAt} /></>}</small>}</div>
            {resident && <button onClick={() => setChat({ resident, draft: `我在住地看到这件事：${text}（${status}）。想聊聊吗？` })}>聊聊这件事</button>}
          </li>;
        })}</ul>
      </section>}
    </>}
    {chat && <Conversation key={`${chat.resident.agentHandle}/${chat.draft}`} target={chat} close={() => setChat(null)} />}
  </main>;
}

createRoot(document.getElementById('root')!).render(<Utopia />);
