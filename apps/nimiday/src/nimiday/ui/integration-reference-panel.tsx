import { useEffect, useRef, useState } from 'react';
import { Button, InlineAlert } from '@nimiplatform/kit/ui';
import type { NimiIntegrationTarget } from '@nimiplatform/sdk/app';
import { getNimiLocalAppClient } from '../../shell/auth/local-app-client.js';
import { useNimiDay } from '../app/context.js';
import { integrationReferenceDocument, parseGoVersionReference, referenceHandbookNote } from '../domain/integration-reference.js';
import { Card } from './common.js';
import { GoVersionReferenceField } from './go-version-reference-field.js';

type Reading = { cancelled: boolean; callId?: string };
export function IntegrationReferencePanel({ targets, refresh }: { targets: readonly NimiIntegrationTarget[]; refresh: () => Promise<void> }) {
  const { actions, store, copy, language } = useNimiDay();
  const text = copy.references;
  const client = getNimiLocalAppClient();
  const choices = targets.flatMap(target => target.operations.filter(operation => operation.effect === 'read' && target.permittedOperations.includes(operation.name)).map(operation => ({ target, operation, key: `${target.targetRef}:${operation.name}` })));
  const [selected, setSelected] = useState('');
  const [input, setInput] = useState('{}');
  const [content, setContent] = useState('');
  const [rawResult, setRawResult] = useState('');
  const [source, setSource] = useState('');
  const [title, setTitle] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const reading = useRef<Reading | null>(null);
  const choice = choices.find(value => value.key === selected);
  const goDocument = choice?.target.integrationId === 'nimi.go.deliverables' && choice.operation.name === 'deliverable.read';
  const cancel = () => { const current = reading.current; if (current) { current.cancelled = true; if (current.callId) void client.integration.cancelCall({ callId: current.callId }).catch(() => {}); } reading.current = null; setBusy(false); };
  useEffect(() => () => { const current = reading.current; if (current) { current.cancelled = true; if (current.callId) void client.integration.cancelCall({ callId: current.callId }).catch(() => {}); } }, [client]);
  const read = async () => {
    if (!choice || !choice.target.available || busy) return;
    const current: Reading = { cancelled: false }; reading.current = current;
    setBusy(true); setError(''); setContent(''); setRawResult(''); setSource(''); setSaved(false);
    try {
      const params = goDocument ? parseGoVersionReference(input, text).reference : JSON.parse(input) as unknown;
      let call = await client.integration.invoke({ targetRef: choice.target.targetRef, operation: choice.operation.name, inputJson: JSON.stringify(params) });
      current.callId = call.callId;
      if (current.cancelled) { await client.integration.cancelCall({ callId: call.callId }); return; }
      while (call.status === 'accepted') {
        await new Promise(resolve => setTimeout(resolve, 250)); if (current.cancelled) return;
        call = await client.integration.getCall({ callId: call.callId });
      }
      if (current.cancelled) return;
      if (call.status !== 'completed' || call.errorCode || !call.resultJson) throw new Error(text.failed(call.errorCode || call.status));
      const value = JSON.parse(call.resultJson) as unknown;
      if (typeof value !== 'string') setRawResult(JSON.stringify(value, null, 2));
      const document = integrationReferenceDocument({ integrationId: choice.target.integrationId, operation: choice.operation.name, displayName: choice.target.displayName }, value, params, text);
      setContent(document.content); setTitle(document.title);
      setSource(`${choice.target.displayName}${choice.target.accountLabel ? ` · ${choice.target.accountLabel}` : ''} · ${new Date().toLocaleString(language === 'zh' ? 'zh-CN' : 'en-US')}`);
    } catch (error) { if (!current.cancelled) { const detail = error as { message?: string; reasonCode?: string }; setError([detail.message || String(error), detail.reasonCode].filter(Boolean).join(' · ')); } }
    finally { if (reading.current === current) { reading.current = null; setBusy(false); } }
  };
  const save = async () => {
    actions.saveNote(referenceHandbookNote({ title, content }, source, text));
    const result = await store.persist();
    if (result.ok) { setSaved(true); setError(''); } else setError(result.error);
  };
  return <Card title={text.title}>
    <p className="nd-faint">{text.intro}</p>
    {error && <InlineAlert tone="warning">{error}</InlineAlert>}
    {choice && !choice.target.available && <InlineAlert tone="warning">{text.unavailable}</InlineAlert>}
    <div className="nd-followup-form">
      <label>{text.source}<select aria-label={text.source} value={selected} onChange={event => { const next = choices.find(value => value.key === event.target.value); setSelected(event.target.value); setInput(next?.target.integrationId === 'nimi.go.deliverables' && next.operation.name === 'deliverable.read' ? '' : '{}'); }} disabled={busy}><option value="">{text.choose}</option>{choices.map(value => <option key={value.key} value={value.key}>{value.target.displayName} · {value.operation.name}</option>)}</select></label>
      {goDocument ? <GoVersionReferenceField value={input} onChange={setInput} disabled={busy} /> : <details><summary>{text.parameters}</summary><textarea aria-label={text.parametersLabel} value={input} onChange={event => setInput(event.target.value)} rows={4} disabled={busy} /><small>{choice?.operation.inputSchemaJson}</small></details>}
      <div className="nd-inline-actions"><Button tone="primary" size="sm" disabled={!choice?.target.available || busy} onClick={() => { void read(); }}>{text.read}</Button>{busy && <Button size="sm" onClick={cancel}>{text.cancel}</Button>}<Button tone="ghost" size="sm" onClick={() => { void refresh().catch(error => setError(String(error))); }}>{text.refresh}</Button></div>
      {content && <><p className="nd-faint">{text.acquired(source)}</p><label>{text.titleField}<input aria-label={text.titleLabel} value={title} onChange={event => { setTitle(event.target.value); setSaved(false); }} /></label><label>{text.bodyField}<textarea aria-label={text.bodyLabel} value={content} onChange={event => { setContent(event.target.value); setSaved(false); }} rows={8} /></label><Button size="sm" disabled={saved || !title.trim() || !content.trim()} onClick={() => { void save().catch(error => setError(error instanceof Error ? error.message : String(error))); }}>{saved ? text.saved : text.save}</Button></>}
      {rawResult && <>{!content && !error && <p className="nd-faint">{text.unrecognized}</p>}<details><summary>{text.raw}</summary><textarea aria-label={text.rawLabel} value={rawResult} readOnly rows={6} /></details></>}
    </div>
  </Card>;
}
