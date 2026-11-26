import { useCallback, useEffect, useRef, useState } from 'react';
import type { NimiAppScope } from '@nimiplatform/kit/core/app-session';
import type { NimiAIConfigSnapshot, NimiAIConfigRecordEdit, NimiAIConfigOptionsQuery, NimiAIConfigOverwriteInput } from '@nimiplatform/kit/core/sdk-contract';
import { Button, Checkbox, SelectField, TextField } from '@nimiplatform/kit/ui';
import { ModelConfigAIConfigSurface, type ModelConfigAIConfigSurfaceProps } from './model-config-ai-config-surface.js';

type Props = Pick<ModelConfigAIConfigSurfaceProps, 'capabilityContracts' | 'language' | 'onOpenOwnerConfiguration' | 'copy'> & {
  readonly scope: NimiAppScope;
  readonly appId: string;
  readonly contentLayer?: 'popover' | 'dialog';
};

export function AppModelConfigSurface(props: Props) {
  return <ScopedEditor key={props.scope.viewKey} {...props} />;
}

function ScopedEditor({ scope, appId, contentLayer, ...presentation }: Props) {
  const [snapshot, setSnapshot] = useState<NimiAIConfigSnapshot>();
  const [recordsSnapshot, setRecordsSnapshot] = useState<NimiAIConfigSnapshot>();
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
      if (current()) {
        selected.current = result.record?.configRef;
        setSnapshot(result);
        if (result.records) setRecordsSnapshot(result);
        setError(null);
      }
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
  const change = async (record: NimiAIConfigRecordEdit, copyCapabilities = true) => {
    if (writing.current || !snapshot) return false;
    writing.current = true; setLoading(true); setError(null);
    try {
      const result = await overwrite({ record, expectedRevision: record.action === 'create' ? '0' : snapshot.revision,
        capabilities: record.action === 'create' && copyCapabilities ? snapshot.config?.capabilities ?? [] : [] });
      if (result.outcome === 'conflict') setError(text('The configuration changed or this name already exists.', '配置已变更或名称已存在。'));
      return result.outcome === 'committed';
    } catch (cause) { if (!scope.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause)); return false; }
    finally { writing.current = false; if (!scope.signal.aborted) setLoading(false); }
  };
  const current = snapshot?.record;
  const controlsSnapshot = snapshot?.records ? snapshot : recordsSnapshot;
  return <>
    {controlsSnapshot?.records && <AIConfigRecordControls snapshot={controlsSnapshot} selectedRef={selected.current} busy={writing.current} readPending={loading || !snapshot} language={presentation.language} contentLayer={contentLayer}
      onSelect={ref => { selected.current = ref; setSnapshot(undefined); void refresh(ref); }} onEdit={change} />}
    <ModelConfigAIConfigSurface key={current?.configRef ?? 'default'} {...presentation} context={{ owner: 'app-ai-config', appId }}
      capabilities={snapshot ? snapshot.config?.capabilities ?? null : undefined} revision={snapshot?.revision}
      effectiveSelections={snapshot?.effectiveSelections} loading={loading && !snapshot} loadError={error}
      onRetry={() => void refresh()} listOptions={(query:NimiAIConfigOptionsQuery) => {scope.signal.throwIfAborted();return scope.client.aiConfig.listOptions(query);}}
      onOverwrite={input => overwrite({...input,...(current ? {record:{action:'save',configRef:current.configRef}} : {})})} />
  </>;
}

export function AIConfigRecordControls({snapshot, selectedRef, busy, readPending, language, contentLayer, onSelect, onEdit}: {
  readonly snapshot: NimiAIConfigSnapshot;
  readonly selectedRef?: string;
  readonly busy: boolean;
  readonly readPending?: boolean;
  readonly language?: string | null;
  readonly contentLayer?: 'popover' | 'dialog';
  readonly onSelect: (ref:string)=>void;
  readonly onEdit: (edit:NimiAIConfigRecordEdit, copyCapabilities?: boolean)=>Promise<boolean>;
}) {
  const current = snapshot.record;
  const activeRef = selectedRef ?? current?.configRef ?? '';
  const [editing,setEditing]=useState<'create'|'rename'|'delete'>();
  const [name,setName]=useState('');
  const [copyCapabilities, setCopyCapabilities] = useState(true);
  const editsDisabled = busy || readPending;
  const text=(en:string,cn:string)=>language?.startsWith('zh')?cn:en;
  const change=async (edit:NimiAIConfigRecordEdit)=>{
    if (await onEdit(edit, edit.action === 'create' ? copyCapabilities : undefined)) {setEditing(undefined);setName('');}
  };
  return <section aria-label={text('Named configurations', '具名配置')} className="mb-4 flex flex-wrap items-center gap-2">
      {current && <div className="flex items-center gap-2">
        <span className="shrink-0 whitespace-nowrap text-xs font-semibold text-[var(--nimi-text-secondary)]">{text('Configuration', '配置')}</span>
        <SelectField
          aria-label={text('Configuration', '配置')}
          className="min-w-[180px]"
          contentLayer={contentLayer}
          value={activeRef}
          disabled={busy}
          options={(snapshot.records ?? []).map(r => ({
            value: r.configRef,
            label: `${r.name}${r.isDefault ? text(' (default)', '（默认）') : ''}`,
          }))}
          onValueChange={ref => {
            setEditing(undefined);
            setName('');
            onSelect(ref);
          }}
        />
      </div>}
      <Button tone="secondary" disabled={editsDisabled} onClick={() => {setEditing('create');setCopyCapabilities(true);setName('');}}>{text('New configuration', '新建配置')}</Button>
      {current && <>
        <Button tone="ghost" disabled={editsDisabled} onClick={() => {setEditing('rename');setName(current.name);}}>{text('Rename', '重命名')}</Button>
        {!current.isDefault && <><Button tone="ghost" disabled={editsDisabled} onClick={() => void change({action:'make-default',configRef:current.configRef})}>{text('Make default','设为默认')}</Button>
          <Button tone="ghost" disabled={editsDisabled} onClick={() => setEditing('delete')}>{text('Delete','删除')}</Button></>}
      </>}
      {editing && <div className="flex w-full flex-wrap items-center gap-2">
        {editing === 'delete' ? <span className="text-xs text-[var(--nimi-text-secondary)]">{text('Sessions using this configuration will need to select another one.', '使用此配置的会话需要重新选择配置。')}</span>
          : <label className="flex items-center gap-2 text-xs font-medium text-[var(--nimi-text-secondary)]"><span>{text('Configuration name','配置名称')}</span><TextField value={name} maxLength={128} onChange={e=>setName(e.currentTarget.value)} className="min-w-[180px]" /></label>}
        {editing === 'create' && Boolean(snapshot.config?.capabilities.length) && (
          <Checkbox
            checked={copyCapabilities}
            disabled={editsDisabled}
            onChange={event => setCopyCapabilities(event.currentTarget.checked)}
            label={text('Copy current capability settings', '复制当前能力设置')}
          />
        )}
        <Button tone={editing === 'delete' ? 'danger' : 'primary'} disabled={editsDisabled || (editing !== 'delete' && !name.trim())} onClick={() => {
          if (editing === 'create') void change({action:'create', name:name.trim()});
          if (current && editing === 'rename') void change({action:'rename',configRef:current.configRef,name:name.trim()});
          if (current && editing === 'delete') void change({action:'delete',configRef:current.configRef});
        }}>{editing === 'delete' ? text('Delete configuration','确认删除') : text('Save name','保存名称')}</Button>
        <Button tone="ghost" disabled={busy} onClick={()=>setEditing(undefined)}>{text('Cancel','取消')}</Button>
      </div>}
    </section>;
}
