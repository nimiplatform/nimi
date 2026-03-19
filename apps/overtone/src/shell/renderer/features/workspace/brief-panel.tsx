import React, { useCallback, useState } from 'react';
import { getPlatformClient } from '@nimiplatform/sdk';
import { useAppStore, type SongBrief } from '@renderer/app-shell/providers/app-store.js';
import { collectTextStream } from './runtime-workflow.js';
import { ErrorDisplay } from './error-display.js';

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
    <div className="space-y-4">
      <h2 className="text-sm font-semibold text-zinc-300 uppercase tracking-wider">Song Brief</h2>

      <div className="space-y-2">
        <textarea
          className="w-full h-24 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 resize-none focus:outline-none focus:border-zinc-500"
          placeholder="Describe your song idea..."
          value={idea}
          onChange={(event) => setIdea(event.target.value)}
        />
        <div className="flex gap-2">
          <button
            className="px-4 py-1.5 text-xs font-medium bg-zinc-800 hover:bg-zinc-700 rounded-md transition-colors disabled:opacity-40"
            onClick={handleGenerateBrief}
            disabled={!idea.trim() || isGeneratingBrief || !textConnectorAvailable}
            type="button"
          >
            {isGeneratingBrief ? 'Generating brief...' : 'AI Generate Brief'}
          </button>
          <button
            className="px-4 py-1.5 text-xs font-medium bg-zinc-900 border border-zinc-700 hover:border-zinc-600 rounded-md transition-colors disabled:opacity-40"
            onClick={handleCreateManualBrief}
            disabled={!idea.trim()}
            type="button"
          >
            Manual Brief
          </button>
        </div>
        {!textConnectorAvailable && (
          <p className="text-xs text-amber-400">
            No text connector/model pair is ready. Use Manual Brief or configure runtime text access.
          </p>
        )}
        {error ? (
          <ErrorDisplay error={error} onDismiss={() => setError(null)} onRetry={handleGenerateBrief} />
        ) : null}
      </div>

      {brief && (
        <div className="space-y-3">
          <BriefField label="Title" value={brief.title} onChange={(value) => setBrief({ ...brief, title: value })} />
          <BriefField label="Genre" value={brief.genre} onChange={(value) => setBrief({ ...brief, genre: value })} />
          <BriefField label="Mood" value={brief.mood} onChange={(value) => setBrief({ ...brief, mood: value })} />
          <BriefField label="Tempo" value={brief.tempo} onChange={(value) => setBrief({ ...brief, tempo: value })} />
          <div className="space-y-1">
            <label className="text-xs font-medium text-zinc-400">Description</label>
            <textarea
              className="w-full h-24 bg-zinc-900 border border-zinc-700 rounded-md px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 resize-none focus:outline-none focus:border-zinc-500"
              value={brief.description}
              onChange={(event) => setBrief({ ...brief, description: event.target.value })}
              placeholder="Creative direction"
            />
          </div>
        </div>
      )}

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium text-zinc-400">Lyrics</label>
          <button
            className="text-xs text-zinc-400 hover:text-zinc-200 transition-colors disabled:opacity-40"
            onClick={handleGenerateLyrics}
            disabled={isGeneratingLyrics || !textConnectorAvailable || !buildBriefContext(brief, idea)}
            type="button"
          >
            {isGeneratingLyrics ? 'Writing...' : lyrics ? 'Regenerate Lyrics' : 'Generate Lyrics'}
          </button>
        </div>
        <textarea
          className="w-full h-40 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 resize-none focus:outline-none focus:border-zinc-500 font-mono"
          placeholder="Write or paste lyrics here..."
          value={lyrics}
          onChange={(event) => setLyrics(event.target.value)}
        />
      </div>
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
      <label className="text-xs font-medium text-zinc-400">{label}</label>
      <input
        className="w-full bg-zinc-900 border border-zinc-700 rounded-md px-3 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}
