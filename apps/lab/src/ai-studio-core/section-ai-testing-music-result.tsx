import { useEffect, useState } from 'react';
import { Button, TextareaField } from '@nimiplatform/kit/ui';
import { useAIStudioHost } from './host-context.js';
import type { StudioMusicGeneration } from './runtime-types.js';

export function MusicGenerationNotice({ value }: { readonly value?: StudioMusicGeneration }) {
  const host = useAIStudioHost();
  const { translate: t } = host;
  const [expanded, setExpanded] = useState(false);
  const [score, setScore] = useState('');
  const [error, setError] = useState('');
  const scorePath = value?.generatedScore?.relativePath;
  useEffect(() => {
    let active = true;
    setScore(''); setError('');
    if (expanded && scorePath) void (async () => {
      const read = await host.sdk.assets.read({ relativePath: scorePath });
      if (read.asset.mediaType !== 'text/vnd.abc' || read.asset.sizeBytes > 1048576) throw new Error(t('Music.scoreTooLarge'));
      const bytes = new Uint8Array(read.asset.sizeBytes);
      let offset = 0;
      for await (const chunk of read.body) {
        if (offset + chunk.length > bytes.length) throw new Error(t('Music.scoreTooLarge'));
        bytes.set(chunk, offset); offset += chunk.length;
      }
      if (offset !== bytes.length) throw new Error(t('Music.scoreIncomplete'));
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      if (active) setScore(text);
    })().catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { active = false; };
  }, [expanded, scorePath, host, t]);
  if (!value) return null;
  return <div role="status" className="space-y-1 text-sm">
    <p>{t(value.termination === 'model-end' ? 'Music.terminationModelEnd' : value.termination === 'budget-limit' ? 'Music.terminationBudget' : 'Music.terminationUnknown')}</p>
    {value.generatedScore?.truncated ? <p>{t('Music.scoreTruncated')}</p> : null}
    {scorePath ? <div className="space-y-2">
      <Button onClick={() => setExpanded((current) => !current)}>{t(expanded ? 'Music.hideScore' : 'Music.viewScore')}</Button>
      {expanded && score ? <>
        <TextareaField value={score} readOnly textareaClassName="min-h-40 font-mono" aria-label={t('Music.generatedPlan')} />
        <Button onClick={() => void host.app.commands.exportText({ filename: 'generated-score.abc', body: score })
          .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))}>{t('Music.exportScore')}</Button>
      </> : null}
      {error ? <p role="alert">{error}</p> : null}
    </div> : null}
  </div>;
}
