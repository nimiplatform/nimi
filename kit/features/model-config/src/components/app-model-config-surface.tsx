import { useCallback, useEffect, useRef, useState } from 'react';
import type { NimiAppScope } from '@nimiplatform/kit/core/app-session';
import type { NimiAIConfigSnapshot, NimiAIConfigRecordEdit, NimiAIConfigOptionsQuery, NimiAIConfigOverwriteInput } from '@nimiplatform/kit/core/sdk-contract';
import { Button } from '@nimiplatform/kit/ui';
import { ModelConfigAIConfigSurface, type ModelConfigAIConfigSurfaceProps } from './model-config-ai-config-surface.js';

type Props = Pick<ModelConfigAIConfigSurfaceProps, 'capabilityContracts' | 'language' | 'onOpenOwnerConfiguration' | 'copy'> & {
  readonly scope: NimiAppScope;
  readonly appId: string;
};

export function AppModelConfigSurface(props: Props) {
  return <ScopedEditor key={props.scope.viewKey} {...props} />;
}

function ScopedEditor({ scope, appId, ...presentation }: Props) {
  const [snapshot, setSnapshot] = useState<NimiAIConfigSnapshot>();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const selected = useRef<string | undefined>(undefined);
  const latest = useRef(0);
  const writing = useRef(false);
  const zh = presentation.language?.startsWith('zh');
  const text = (en: string, cn: string) => zh ? cn : en;
  const refresh = useCallback(async (ref = selected.current) => {
    const generation = ++latest.current;
    const current = () => generation === latest.current && !scope.signal.aborted;
    setLoading(true);
    try {
      scope.signal.throwIfAborted();
      const result = await scope.client.aiConfig.get({ includeRecords: true, ...(ref ? {configRef:ref} : {}) });
      if (current()) { selected.current = result.record?.configRef; setSnapshot(result); setError(null); }
    } catch (cause) {
      if (current()) { setSnapshot(undefined); setError(cause instanceof Error ? cause.message : String(cause)); }
    } finally { if (current()) setLoading(false); }
  }, [scope]);
  useEffect(() => {
    void refresh();
    const onFocus = () => { if (!writing.current) void refresh(); };
    window.addEventListener('focus', onFocus);
    return () => {
      ++latest.current;
      window.removeEventListener('focus', onFocus);
    };
  }, [refresh]);

  const overwrite = async (input: NimiAIConfigOverwriteInput) => {
    scope.signal.throwIfAborted();
    const result = await scope.client.aiConfig.overwrite(input);
    scope.signal.throwIfAborted();
    await refresh(result.record?.configRef ?? selected.current);
    return result;
  };
  const change = async (record: NimiAIConfigRecordEdit) => {
    if (writing.current || !snapshot) return false;
    writing.current = true; setLoading(true); setError(null);
    try {
      const result = await overwrite({ record, expectedRevision: record.action === 'create' ? '0' : snapshot.revision,
        capabilities: record.action === 'create' ? snapshot.config?.capabilities ?? [] : [] });
      if (result.outcome === 'conflict') setError(text('The configuration changed or this name already exists.', '配置已变更或名称已存在。'));
      return result.outcome === 'committed';
    } catch (cause) { if (!scope.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause)); return false; }
    finally { writing.current = false; if (!scope.signal.aborted) setLoading(false); }
  };
  const current = snapshot?.record;
  return <>
    {snapshot?.records && <AIConfigRecordControls snapshot={snapshot} busy={loading} language={presentation.language}
      onSelect={ref => { selected.current = ref; setSnapshot(undefined); void refresh(ref); }} onEdit={change} />}
    <ModelConfigAIConfigSurface key={current?.configRef ?? 'default'} {...presentation} context={{ owner: 'app-ai-config', appId }}
      capabilities={snapshot ? snapshot.config?.capabilities ?? null : undefined} revision={snapshot?.revision}
      effectiveSelections={snapshot?.effectiveSelections} loading={loading && !snapshot} loadError={error}
      onRetry={() => void refresh()} listOptions={(query:NimiAIConfigOptionsQuery) => {scope.signal.throwIfAborted();return scope.client.aiConfig.listOptions(query);}}
      onOverwrite={input => overwrite({...input,...(current ? {record:{action:'save',configRef:current.configRef}} : {})})} />
  </>;
}

export function AIConfigRecordControls({snapshot, busy, language, onSelect, onEdit}: {
  readonly snapshot: NimiAIConfigSnapshot;
  readonly busy: boolean;
  readonly language?: string | null;
  readonly onSelect: (ref:string)=>void;
  readonly onEdit: (edit:NimiAIConfigRecordEdit)=>Promise<boolean>;
}) {
  const current=snapshot.record;
  const [editing,setEditing]=useState<'create'|'rename'|'delete'>();
  const [name,setName]=useState('');
  const text=(en:string,cn:string)=>language?.startsWith('zh')?cn:en;
  const change=async (edit:NimiAIConfigRecordEdit)=>{
    if (await onEdit(edit)) {setEditing(undefined);setName('');}
  };
  return <section aria-label={text('Named configurations', '具名配置')} className="mb-4 flex flex-wrap items-center gap-2">
      {current && <label>{text('Configuration', '配置')} <select value={current.configRef} disabled={busy} onChange={event => {
        const ref=event.currentTarget.value; setEditing(undefined); setName(''); onSelect(ref);
      }}>{snapshot.records?.map(r => <option key={r.configRef} value={r.configRef}>{r.name}{r.isDefault ? text(' (default)', '（默认）') : ''}</option>)}</select></label>}
      <Button tone="secondary" disabled={busy} onClick={() => {setEditing('create');setName('');}}>{text('New configuration', '新建配置')}</Button>
      {current && <>
        <Button tone="ghost" disabled={busy} onClick={() => {setEditing('rename');setName(current.name);}}>{text('Rename', '重命名')}</Button>
        {!current.isDefault && <><Button tone="ghost" disabled={busy} onClick={() => void change({action:'make-default',configRef:current.configRef})}>{text('Make default','设为默认')}</Button>
          <Button tone="ghost" disabled={busy} onClick={() => setEditing('delete')}>{text('Delete','删除')}</Button></>}
      </>}
      {editing && <div className="flex w-full items-center gap-2">
        {editing === 'delete' ? <span>{text('Sessions using this configuration will need to select another one.', '使用此配置的会话需要重新选择配置。')}</span>
          : <label>{text('Configuration name','配置名称')} <input value={name} maxLength={128} onChange={e=>setName(e.currentTarget.value)} /></label>}
        <Button disabled={busy || (editing !== 'delete' && !name.trim())} onClick={() => {
          if (editing === 'create') void change({action:'create', name:name.trim()});
          if (current && editing === 'rename') void change({action:'rename',configRef:current.configRef,name:name.trim()});
          if (current && editing === 'delete') void change({action:'delete',configRef:current.configRef});
        }}>{editing === 'delete' ? text('Delete configuration','确认删除') : text('Save name','保存名称')}</Button>
        <Button tone="ghost" disabled={busy} onClick={()=>setEditing(undefined)}>{text('Cancel','取消')}</Button>
      </div>}
    </section>;
}
