import { useNimiDay } from '../app/context.js';
import { parseGoVersionReference, type GoVersionReference } from '../domain/integration-reference.js';

export function GoVersionReferenceField({ value, onChange, disabled = false, required = false }: { value: string; onChange: (value: string) => void; disabled?: boolean; required?: boolean }) {
  const copy = useNimiDay().copy.references;
  let reference: GoVersionReference | null = null; let error = '';
  if (value.trim()) { try { reference = parseGoVersionReference(value, copy); } catch (failure) { error = failure instanceof Error ? failure.message : String(failure); } }
  return <div>
    <label>{copy.pasteGo}<textarea aria-label={copy.pasteGo} value={value} onChange={event => onChange(event.target.value)} disabled={disabled} required={required} aria-invalid={!!error} rows={3} placeholder={copy.pasteHint} /></label>
    {error && <p className="nd-faint" role="alert">{error}</p>}
    {reference && <p className="nd-faint">{copy.preview}：<strong>{reference.title || copy.goDocument}</strong> · {reference.version ? copy.version(reference.version) : copy.exactVersion}<br />{copy.referenceHint}</p>}
  </div>;
}
