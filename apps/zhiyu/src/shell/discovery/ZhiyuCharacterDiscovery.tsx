import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowUpRight, Search } from 'lucide-react';
import { Button, SearchField } from '@nimiplatform/kit/ui';
import { createNimiClientId } from '@nimiplatform/sdk';
import { extractNimiErrorFields } from '@nimiplatform/sdk/types';
import type { NimiAppCharacterDiscoveryClient, NimiAppCharacterSource, NimiLocalAppAgentReference } from '@nimiplatform/sdk/app';

type Page = { items: readonly NimiAppCharacterSource[]; nextCursor: string; pages: number; inventoryKey: string };
export type ZhiyuCharacterCache = Map<string, Page>;
export const characterKey = (item: NimiAppCharacterSource) => `${item.sourceRef.kind}:${item.sourceRef.worldId}:${item.sourceRef.id}`;
function discoveryFailure(error: unknown, fallback: string) {
  const reason = extractNimiErrorFields(error).reasonCode;
  return ['LOCAL_APP_ACCESS_DENIED', 'LOCAL_APP_OPERATION_UNAVAILABLE', 'runtime-permission-denied'].includes(reason ?? '')
    ? '当前客户端尚未获准发现角色和建立伙伴。请在 Nimi Home 检查应用接入；已有伙伴仍可继续交流。' : fallback;
}

// @nimi-authority: rule.nimi.zhiyu.local-partner-surface.character-discovery
export function ZhiyuCharacterDiscovery({ client, cache, inventoryKey, query, selectedKey, onSearch, onSelect, onPartner, onBack, openWorld }: {
  client: NimiAppCharacterDiscoveryClient; cache: ZhiyuCharacterCache; inventoryKey: string; query: string; selectedKey?: string;
  onSearch(query: string): void; onSelect(key?: string): void; onPartner(partner: NimiLocalAppAgentReference): void;
  onBack(): void; openWorld?: (worldId: string) => Promise<void>;
}) {
  const [input, setInput] = useState(query);
  const [page, setPage] = useState<Page | null>(() => cache.get(query) ?? null);
  const [loading, setLoading] = useState(false), [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0), pending = useRef(false);
  async function read(append = false) {
    if (pending.current) return;
    pending.current = true;
    const current = generation.current;
    setLoading(true); setError(null);
    try {
      const previous = cache.get(query);
      const pagesToRead = append ? 1 : previous?.pages ?? 1;
      let nextCursor = append ? previous?.nextCursor ?? '' : '';
      let pages = append ? previous?.pages ?? 0 : 0;
      const items = append ? [...(previous?.items ?? [])] : [];
      // Refresh the already loaded depth with fresh cursors. Keep the current
      // list and selection visible until the complete replacement is available.
      for (let index = 0; index < pagesToRead; index++) {
        const next = await client.listCharacters({ query, ...(nextCursor ? { cursor: nextCursor } : {}) });
        if (current !== generation.current) return;
        items.push(...next.items);
        nextCursor = next.nextCursor;
        pages++;
        if (!nextCursor) break;
      }
      const result = { nextCursor, pages, inventoryKey, items: [...new Map(items.map(item => [characterKey(item), item])).values()] };
      cache.set(query, result); setPage(result);
    } catch (error) { if (current === generation.current) setError(discoveryFailure(error, '暂时无法读取角色，请检查连接后重试。')); }
    finally { if (current === generation.current) { pending.current = false; setLoading(false); } }
  }
  useEffect(() => {
    generation.current++; pending.current = false; setConnecting(false); setLoading(false); setError(null); setInput(query);
    const cached = cache.get(query); setPage(cached ?? null);
    if (!cached || cached.inventoryKey !== inventoryKey) void read();
    return () => { generation.current++; pending.current = false; };
  }, [query, client, cache, selectedKey, inventoryKey]);
  const selected = page?.items.find(item => characterKey(item) === selectedKey);
  async function connect(item: NimiAppCharacterSource) {
    if (pending.current) return;
    pending.current = true; setConnecting(true); setError(null);
    const current = generation.current;
    try {
      const result = await client.connectCharacter({ sourceRef: item.sourceRef, requestId: createNimiClientId('zhiyu-character') });
      if (current !== generation.current) return;
      if (page) { const updated = { ...page, items: page.items.map(value => characterKey(value) === characterKey(item) ? { ...value, existingPartner: result.partner } : value) }; cache.set(query, updated); setPage(updated); }
      onPartner(result.partner);
    } catch (error) { if (current === generation.current) setError(discoveryFailure(error, '暂时无法进入伙伴对话。若伙伴已建立，会保留在「我的伙伴」中；请刷新后再试。')); }
    finally { if (current === generation.current) { pending.current = false; setConnecting(false); } }
  }
  return <section className="zhiyu-discovery" aria-label="发现角色">
    <header className="zhiyu-discovery__header">
      <Button tone="ghost" size="sm" leadingIcon={<ArrowLeft size={16} />} onClick={selectedKey ? () => onSelect() : onBack}>{selectedKey ? '返回角色列表' : '返回对话'}</Button>
      <h2>{selected?.displayName ?? '发现角色'}</h2>
      <p>认识来自不同世界的角色，成为伙伴后，在织羽继续交流。</p>
    </header>
    {error && <div role="alert" className="zhiyu-discovery__notice">{error} <Button tone="ghost" size="sm" disabled={loading || connecting} onClick={() => void read()}>重新读取</Button></div>}
    {selected ? <div className="zhiyu-discovery__detail">
      <div className="zhiyu-discovery__identity">{selected.avatarUrl && <img src={selected.avatarUrl} alt="" referrerPolicy="no-referrer" />}<div><p>来自 {selected.worldName}</p>{selected.existingPartner && <p>已是你的伙伴</p>}</div></div>
      <p className="whitespace-pre-wrap">{selected.summary}</p>
      {selected.disposition && <div><h3>性格</h3><p className="whitespace-pre-wrap">{selected.disposition}</p></div>}
      {selected.traits.length > 0 && <div><h3>特点</h3><p>{selected.traits.join(' · ')}</p></div>}
      {selected.topics.length > 0 && <div><h3>可以聊聊</h3><p>{selected.topics.join(' · ')}</p></div>}
      <div className="zhiyu-discovery__actions"><Button disabled={loading || connecting || (!selected.connectable && !selected.existingPartner)} onClick={() => void connect(selected)}>{connecting ? '正在进入…' : selected.existingPartner ? '继续聊天' : '成为伙伴并聊天'}</Button>
      {openWorld && <Button tone="secondary" disabled={connecting} trailingIcon={<ArrowUpRight size={16} />} onClick={() => void openWorld(selected.sourceRef.worldId).catch(() => setError('暂时无法在 Nimi Home 打开这个世界，请稍后再试。'))}>在 Home 查看世界</Button>}</div>
      {!selected.connectable && !selected.existingPartner && <p role="status">这位角色目前无法成为伙伴。你仍可阅读介绍。</p>}
    </div> : <>
      <form className="zhiyu-discovery__search" onSubmit={event => { event.preventDefault(); onSearch(input.trim()); }}><SearchField aria-label="搜索角色" placeholder="搜索角色或世界" maxLength={256} value={input} onChange={event => setInput(event.target.value)} onClear={() => { setInput(''); onSearch(''); }} clearLabel="清除搜索" /><Button tone="secondary" leadingIcon={<Search size={16} />} type="submit" disabled={loading}>搜索</Button></form>
      {selectedKey && page && <p role="status">这位角色已不在当前结果中，请重新选择。</p>}
      {loading && !page && <p role="status">正在寻找角色…</p>}
      {page && page.items.length === 0 && <p role="status">{query ? '没有找到匹配的角色，试试其他关键词。' : '暂时没有可发现的角色，请稍后刷新。'}</p>}
      <div className="zhiyu-discovery__list">{page?.items.map(item => <button type="button" className="zhiyu-discovery__row" key={characterKey(item)} onClick={() => onSelect(characterKey(item))} disabled={connecting}>
        {item.avatarUrl ? <img src={item.avatarUrl} alt="" referrerPolicy="no-referrer" /> : <span className="zhiyu-discovery__initial" aria-hidden="true">{Array.from(item.displayName)[0]}</span>}
        <span className="zhiyu-discovery__row-copy"><strong>{item.displayName}</strong><span>{item.worldName}{item.existingPartner ? ' · 已是伙伴' : ''}</span><span className="zhiyu-discovery__summary">{item.summary}</span></span>
      </button>)}</div>
      <div className="zhiyu-discovery__actions">{page?.nextCursor && <Button tone="secondary" disabled={loading} onClick={() => void read(true)}>{loading ? '正在读取…' : '查看更多角色'}</Button>}<Button tone="ghost" disabled={loading} onClick={() => void read()}>刷新</Button></div>
    </>}
  </section>;
}
