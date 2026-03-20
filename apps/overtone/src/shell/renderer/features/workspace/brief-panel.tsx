import React, { useCallback, useState } from 'react';
import { getPlatformClient } from '@nimiplatform/sdk';
import { useAppStore, type SongBrief } from '@renderer/app-shell/providers/app-store.js';
import { collectTextStream } from './runtime-workflow.js';
import { ErrorDisplay } from './error-display.js';
import { OtButton, OtInput, OtTextarea, OtAccordionSection } from './ui-primitives.js';

const BRIEF_SYSTEM_PROMPT = `You are a music production assistant. Given a song idea, output a structured brief as JSON with these fields:
- title: short catchy title (max 50 chars)
- genre: primary genre(s)
- mood: emotional tone
- tempo: slow/moderate/fast
- description: 1-2 sentence creative direction

Output ONLY valid JSON, no markdown fences or extra text.`;

const LYRICS_SYSTEM_PROMPT = `You are a songwriting assistant.
Write singable lyrics that follow the provided brief.
Return plain lyrics only, with section labels when useful.`;

export function BriefPanel() {
  const brief = useAppStore((state) => state.brief);
  const setBrief = useAppStore((state) => state.setBrief);
  const lyrics = useAppStore((state) => state.lyrics);
  const setLyrics = useAppStore((state) => state.setLyrics);
  const textConnectorAvailable = useAppStore((state) => state.textConnectorAvailable);
  const selectedTextConnectorId = useAppStore((state) => state.selectedTextConnectorId);
  const selectedTextModelId = useAppStore((state) => state.selectedTextModelId);

  const [idea, setIdea] = useState('');
  const [isGeneratingBrief, setIsGeneratingBrief] = useState(false);
  const [isGeneratingLyrics, setIsGeneratingLyrics] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const generateText = useCallback(async (
    input: string,
    system: string,
    options: { temperature: number; maxTokens: number },
  ) => {
    if (!selectedTextModelId || !selectedTextConnectorId) {
      throw new Error('No ready text connector/model pair is available.');
    }
    const runtime = getPlatformClient().runtime;
    const output = await runtime.ai.text.stream({
      model: selectedTextModelId,
      connectorId: selectedTextConnectorId,
      input,
      system,
      temperature: options.temperature,
      maxTokens: options.maxTokens,
    });
    return collectTextStream(output);
  }, [selectedTextConnectorId, selectedTextModelId]);

  const handleGenerateBrief = useCallback(async () => {
    if (!idea.trim()) {
      return;
    }
    setIsGeneratingBrief(true);
    setError(null);
    try {
      const text = await generateText(idea.trim(), BRIEF_SYSTEM_PROMPT, {
        temperature: 0.9,
        maxTokens: 1024,
      });
      const parsed = parseBriefJson(text);
      if (!parsed) {
        throw new Error('Text model returned non-JSON brief content.');
      }
      setBrief(parsed);
    } catch (nextError: unknown) {
      setError(nextError);
    } finally {
      setIsGeneratingBrief(false);
    }
  }, [generateText, idea, setBrief]);

  const handleGenerateLyrics = useCallback(async () => {
    const briefContext = buildBriefContext(brief, idea);
    if (!briefContext) {
      return;
    }
    setIsGeneratingLyrics(true);
    setError(null);
    try {
      const text = await generateText(briefContext, LYRICS_SYSTEM_PROMPT, {
        temperature: 0.85,
        maxTokens: 768,
      });
      setLyrics(text.trim());
    } catch (nextError: unknown) {
      setError(nextError);
    } finally {
      setIsGeneratingLyrics(false);
    }
  }, [brief, generateText, idea, setLyrics]);

  const handleCreateManualBrief = useCallback(() => {
    setBrief({
      title: '',
      genre: '',
      mood: '',
      tempo: '',
      description: idea.trim(),
    });
    setError(null);
  }, [idea, setBrief]);

  return (
    <div>
      <OtAccordionSection title="Song Brief" defaultOpen>
        <div className="space-y-3">
          <OtTextarea
            placeholder="Describe your song idea..."
            value={idea}
            onChange={(event) => setIdea(event.target.value)}
            style={{ minHeight: 96 }}
          />
          <div className="flex gap-2">
            <OtButton
              variant="secondary"
              onClick={handleGenerateBrief}
              disabled={!idea.trim() || isGeneratingBrief || !textConnectorAvailable}
              loading={isGeneratingBrief}
              type="button"
            >
              {isGeneratingBrief ? 'Generating...' : 'AI Generate Brief'}
            </OtButton>
            <OtButton
              variant="tertiary"
              onClick={handleCreateManualBrief}
              disabled={!idea.trim()}
              type="button"
            >
              Manual Brief
            </OtButton>
          </div>
          {!textConnectorAvailable && (
            <p className="text-xs text-ot-warning">
              No text connector/model pair is ready. Use Manual Brief or configure runtime text access.
            </p>
          )}
          {error ? (
            <ErrorDisplay error={error} onDismiss={() => setError(null)} onRetry={handleGenerateBrief} />
          ) : null}
        </div>

        {brief && (
          <div className="space-y-3 mt-4">
            <BriefField label="Title" value={brief.title} onChange={(value) => setBrief({ ...brief, title: value })} />
            <BriefField label="Genre" value={brief.genre} onChange={(value) => setBrief({ ...brief, genre: value })} />
            <BriefField label="Mood" value={brief.mood} onChange={(value) => setBrief({ ...brief, mood: value })} />
            <BriefField label="Tempo" value={brief.tempo} onChange={(value) => setBrief({ ...brief, tempo: value })} />
            <div className="space-y-1">
              <label className="text-[11px] text-ot-text-tertiary uppercase tracking-[0.06em]">Description</label>
              <OtTextarea
                value={brief.description}
                onChange={(event) => setBrief({ ...brief, description: event.target.value })}
                placeholder="Creative direction"
                style={{ minHeight: 96 }}
              />
            </div>
          </div>
        )}
      </OtAccordionSection>

      <OtAccordionSection title="Lyrics" defaultOpen={false}>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <label className="text-[11px] text-ot-text-tertiary uppercase tracking-[0.06em]">Lyrics</label>
            <OtButton
              variant="tertiary"
              className="text-[11px] py-0.5 px-2"
              onClick={handleGenerateLyrics}
              disabled={isGeneratingLyrics || !textConnectorAvailable || !buildBriefContext(brief, idea)}
              loading={isGeneratingLyrics}
              type="button"
            >
              {isGeneratingLyrics ? 'Writing...' : lyrics ? 'Regenerate' : 'Generate Lyrics'}
            </OtButton>
          </div>
          <OtTextarea
            className="font-mono"
            style={{ minHeight: 160, lineHeight: 1.8 }}
            placeholder="Write or paste lyrics here..."
            value={lyrics}
            onChange={(event) => setLyrics(event.target.value)}
          />
        </div>
      </OtAccordionSection>
    </div>
  );
}

export function parseBriefJson(text: string): SongBrief | null {
  try {
    const cleaned = text.replace(/```json?\s*/g, '').replace(/```\s*/g, '').trim();
    const value = JSON.parse(cleaned) as Record<string, unknown>;
    return {
      title: String(value.title || '').slice(0, 50),
      genre: String(value.genre || ''),
      mood: String(value.mood || ''),
      tempo: String(value.tempo || ''),
      description: String(value.description || ''),
    };
  } catch {
    return null;
  }
}

export function buildBriefContext(brief: SongBrief | null, idea: string): string {
  if (brief) {
    return [
      `Idea: ${idea.trim()}`,
      `Title: ${brief.title}`,
      `Genre: ${brief.genre}`,
      `Mood: ${brief.mood}`,
      `Tempo: ${brief.tempo}`,
      `Description: ${brief.description}`,
    ].filter(Boolean).join('\n');
  }
  return idea.trim();
}

function BriefField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1">
      <label className="text-[11px] text-ot-text-tertiary uppercase tracking-[0.06em]">{label}</label>
      <OtInput
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}
