export function Banner(props: {
  tone: 'info' | 'warning' | 'error';
  title: string;
  body: string;
}) {
  const palette = props.tone === 'error'
    ? 'border-[color-mix(in_srgb,var(--nimi-status-danger)_28%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-danger)_10%,var(--nimi-surface-card))] text-[var(--nimi-status-danger)]'
    : props.tone === 'warning'
      ? 'border-[color-mix(in_srgb,var(--nimi-status-warning)_28%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-warning)_10%,var(--nimi-surface-card))] text-[var(--nimi-status-warning)]'
      : 'border-[color-mix(in_srgb,var(--nimi-status-info)_28%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-info)_10%,var(--nimi-surface-card))] text-[var(--nimi-status-info)]';
  return (
    <div className={`rounded-2xl border px-4 py-3 ${palette}`}>
      <p className="text-sm font-semibold">{props.title}</p>
      <p className="mt-1 text-xs opacity-90">{props.body}</p>
    </div>
  );
}

export function TextArea(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  disabled?: boolean;
  monospace?: boolean;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-[var(--nimi-text-secondary)]">{props.label}</label>
      <textarea
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        placeholder={props.placeholder}
        rows={props.rows ?? 4}
        disabled={props.disabled}
        spellCheck={false}
        className={`w-full rounded-xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-field-bg)] p-3 text-sm text-[var(--nimi-text-primary)] outline-none focus:border-[var(--nimi-field-focus)] focus:ring-2 focus:ring-[var(--nimi-focus-ring-color)] disabled:cursor-not-allowed disabled:opacity-60 ${props.monospace ? 'font-mono text-xs' : ''}`}
      />
    </div>
  );
}
