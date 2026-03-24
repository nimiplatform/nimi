/**
 * Novel Import Hook — Flow 2 orchestration
 *
 * Manages the full novel import lifecycle with progressive extraction:
 * Load → Chunk → Extract (per-chapter) → Accumulate → Review → Publish
 */

import { useCallback, useRef } from 'react';

import { createForgeAiClient } from '@renderer/pages/worlds/world-create-page-helpers.js';
import { logRendererEvent } from '@nimiplatform/nimi-kit/telemetry';

import { useImportSessionStore } from '../state/import-session-store.js';
import { splitNovelIntoChapters } from '../engines/novel-chunker.js';
import { extractChapter } from '../engines/novel-extraction-engine.js';
import {
  createAccumulator,
  mergeChapterIntoAccumulator,
  accumulatorToImportResult,
  countUnresolvedConflicts,
} from '../state/novel-accumulator.js';
import { publishNovelImport } from '../data/import-publish-client.js';
import type {
  NovelAccumulatorState,
  ChapterExtractionArtifact,
  NovelImportMode,
  ConflictEntry,
  ChapterChunkRecord,
} from '../types.js';
import type { PublishProgress, PublishResult } from '../data/import-publish-client.js';
import type { ChapterChunk } from '../engines/novel-chunker.js';

export function useNovelImport() {
  const store = useImportSessionStore();
  const chunksRef = useRef<ChapterChunk[]>([]);
  const pauseRef = useRef(false);

  const loadFile = useCallback(async (file: File) => {
    store.startNovelImportSession();

    if (file.size > 10 * 1024 * 1024) {
      store.setNovelError('File exceeds 10MB. Consider splitting into volumes.');
      return { success: false, warning: 'File too large' };
    }

    const text = await file.text();
    if (!text.trim()) {
      store.setNovelError('File is empty');
      return { success: false };
    }

    store.setNovelState('FILE_LOADED');
    store.setNovelManifest({
      sourceType: 'novel',
      sourceFile: file.name,
      importedAt: new Date().toISOString(),
      sourceText: text,
      chapterChunks: [],
    });
    // Store raw text for chunking on demand
    chunksRef.current = [];
    return { success: true, text, charCount: text.length };
  }, [store]);

  const startExtraction = useCallback(async (
    sourceText: string,
    sourceFile: string,
    mode: NovelImportMode = 'auto',
  ) => {
    store.setNovelState('CHUNKING');
    store.setNovelMode(mode);

    const chapters = splitNovelIntoChapters(sourceText);
    if (chapters.length === 0) {
      store.setNovelError('No content found after chunking');
      return;
    }

    chunksRef.current = chapters;
    store.setNovelManifest({
      sourceType: 'novel',
      sourceFile,
      importedAt: store.novelImport.sourceManifest?.importedAt || new Date().toISOString(),
      sourceText,
      chapterChunks: chapters as ChapterChunkRecord[],
    });
    const acc = createAccumulator(sourceFile, chapters.length);
    store.setNovelAccumulator(acc);
    store.setNovelProgress(0, chapters.length);
    store.setNovelState('EXTRACTING');
    pauseRef.current = false;

    // Begin extraction loop
    await runExtractionLoop(chapters, acc, mode);
  }, [store]);

  const runExtractionLoop = useCallback(async (
    chapters: ChapterChunk[],
    initialAcc: NovelAccumulatorState,
    mode: NovelImportMode,
  ) => {
    const aiClient = createForgeAiClient();
    let currentAcc = initialAcc;
    let consecutiveFailures = 0;

    for (let i = currentAcc.processedChapters; i < chapters.length; i++) {
      // Check for pause
      if (pauseRef.current) {
        store.setNovelState('PAUSED');
        store.persistNovelSession();
        return;
      }

      const chapter = chapters[i];
      if (!chapter) continue;

      store.setNovelState('EXTRACTING');
      store.setNovelProgress(i, chapters.length);

      // Extract chapter with error recovery
      let artifact: ChapterExtractionArtifact;
      try {
        artifact = await extractChapter(
          aiClient,
          chapter.index,
          chapter.title,
          chapter.text,
          currentAcc,
        );
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logRendererEvent({
          level: 'error',
          area: 'novel-import',
          message: 'action:extraction:chapter-error',
          details: { chapterIndex: i, chapterTitle: chapter.title, error: errorMessage },
        });
        artifact = {
          chapterIndex: chapter.index,
          chapterTitle: chapter.title,
          status: 'FAILED',
          error: errorMessage,
          worldRules: [],
          agentRules: [],
          newCharacters: [],
          contradictions: [],
          chapterSummary: '',
        };
      }

      // Circuit breaker: stop after 3 consecutive failures
      if (artifact.status === 'FAILED') {
        consecutiveFailures++;
        if (consecutiveFailures >= 3) {
          store.setNovelError(`连续 ${consecutiveFailures} 章提取失败，请检查 AI 运行时状态`);
          store.setNovelState('PAUSED');
          store.persistNovelSession();
          return;
        }
      } else {
        consecutiveFailures = 0;
      }

      store.setNovelChapterResult(artifact);

      if (mode === 'manual' && artifact.status === 'COMPLETED') {
        // Manual mode: pause for review
        store.setNovelState('CHAPTER_REVIEW');
        store.persistNovelSession();
        return; // User must call confirmChapter() to continue
      }

      // Auto mode or failed chapter: accumulate and continue
      currentAcc = mergeChapterIntoAccumulator(currentAcc, artifact);
      store.setNovelAccumulator(currentAcc);
      store.setNovelState('ACCUMULATING');
      store.persistNovelSession();
    }

    // All chapters processed
    const unresolvedCount = countUnresolvedConflicts(currentAcc);
    if (unresolvedCount > 0) {
      store.setNovelState('CONFLICT_CHECK');
    } else {
      store.setNovelState('FINAL_REVIEW');
    }
    store.setNovelProgress(chapters.length, chapters.length);
    store.persistNovelSession();
  }, [store]);

  const confirmChapter = useCallback(async (artifact?: ChapterExtractionArtifact) => {
    const acc = store.novelImport.accumulator;
    if (!acc) return;

    const effectiveArtifact = artifact ?? store.novelImport.currentChapterResult;
    if (!effectiveArtifact) return;

    const updatedAcc = mergeChapterIntoAccumulator(acc, effectiveArtifact);
    store.setNovelAccumulator(updatedAcc);
    store.setNovelChapterResult(null);

    // Continue extraction loop
    const chapters = chunksRef.current;
    if (updatedAcc.processedChapters < chapters.length) {
      await runExtractionLoop(chapters, updatedAcc, store.novelImport.mode);
    } else {
      const unresolvedCount = countUnresolvedConflicts(updatedAcc);
      store.setNovelState(unresolvedCount > 0 ? 'CONFLICT_CHECK' : 'FINAL_REVIEW');
      store.persistNovelSession();
    }
  }, [store, runExtractionLoop]);

  const pause = useCallback(() => {
    pauseRef.current = true;
  }, []);

  const resume = useCallback(async () => {
    const acc = store.novelImport.accumulator;
    if (!acc) return;
    pauseRef.current = false;

    const chapters = chunksRef.current.length > 0
      ? chunksRef.current
      : (store.novelImport.sourceManifest?.chapterChunks ?? []);
    if (chapters.length === 0) return;
    chunksRef.current = chapters;

    await runExtractionLoop(chapters, acc, store.novelImport.mode);
  }, [store, runExtractionLoop]);

  const switchMode = useCallback((mode: NovelImportMode) => {
    store.setNovelMode(mode);
  }, [store]);

  const resolveConflict = useCallback((
    conflictIndex: number,
    resolution: ConflictEntry['resolution'],
    mergedStatement?: string,
  ) => {
    store.updateNovelConflict(conflictIndex, resolution, mergedStatement);
  }, [store]);

  const finishConflictCheck = useCallback(() => {
    store.setNovelState('FINAL_REVIEW');
    store.persistNovelSession();
  }, [store]);

  const publish = useCallback(async (params: {
    worldName: string;
    worldDescription: string;
    onProgress?: (progress: PublishProgress) => void;
  }): Promise<PublishResult | null> => {
    const acc = store.novelImport.accumulator;
    if (!acc) return null;

    store.setNovelState('PUBLISHING');
    const { worldRules, agentRules } = accumulatorToImportResult(acc);

    const result = await publishNovelImport({
      worldName: params.worldName,
      worldDescription: params.worldDescription,
      worldRules,
      agentBundles: agentRules,
      targetWorldId: store.targetWorldId,
      onProgress: params.onProgress,
    });

    return result;
  }, [store]);

  return {
    // State
    sessionId: store.sessionId,
    machineState: store.novelImport.machineState,
    mode: store.novelImport.mode,
    sourceManifest: store.novelImport.sourceManifest,
    accumulator: store.novelImport.accumulator,
    currentChapterResult: store.novelImport.currentChapterResult,
    progress: store.novelImport.progress,
    error: store.novelImport.error,
    targetWorldId: store.targetWorldId,

    // Actions
    loadFile,
    startExtraction,
    confirmChapter,
    pause,
    resume,
    switchMode,
    resolveConflict,
    finishConflictCheck,
    setTarget: store.setTarget,
    publish,
    reset: store.resetSession,
  };
}
