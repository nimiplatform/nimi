/**
 * Character Card Import Hook — Flow 1 orchestration
 *
 * Manages the full character card import lifecycle:
 * Load → Parse → Map → Review → Publish
 */

import { useCallback } from 'react';

import { createForgeAiClient } from '@renderer/pages/worlds/world-create-page-helpers.js';

import { useImportSessionStore } from '../state/import-session-store.js';
import { parseCharacterCardV2 } from '../engines/character-card-parser.js';
import {
  mapCharacterCardToAgentRules,
  mapCharacterCardToWorldRules,
} from '../engines/character-card-mapper.js';
import {
  buildClassificationPrompt,
  parseClassificationResponse,
  mapManifestCharacterBookEntriesToRules,
} from '../engines/character-book-mapper.js';
import {
  createCharacterBookManifestEntries,
  createCharacterCardSourceManifest,
  createFallbackClassifications,
} from '../engines/character-card-source-manifest.js';
import { publishCharacterCardImport } from '../data/import-publish-client.js';
import type {
  CharacterCardSourceManifest,
  LorebookClassification,
} from '../types.js';
import type { PublishProgress, PublishResult } from '../data/import-publish-client.js';

const MAX_CHARACTER_CARD_SIZE_BYTES = 2_000_000;

function mapManifestToRuleDrafts(
  manifest: CharacterCardSourceManifest,
) {
  const baseAgentRules = mapCharacterCardToAgentRules(
    manifest.normalizedCard,
    manifest.sourceFile,
  );
  const baseWorldRules = mapCharacterCardToWorldRules(
    manifest.normalizedCard,
    manifest.sourceFile,
  );
  const bookRules = mapManifestCharacterBookEntriesToRules(
    manifest.characterBookEntries,
    manifest.normalizedCard.data.name,
    manifest.sourceFile,
  );

  return {
    agentRules: [...baseAgentRules, ...bookRules.agentRules],
    worldRules: [...baseWorldRules, ...bookRules.worldRules],
  };
}

export function useCharacterCardImport() {
  const store = useImportSessionStore();

  const loadFile = useCallback(async (file: File) => {
    store.startCardImportSession();
    const activeSessionId = useImportSessionStore.getState().sessionId;
    if (file.size > MAX_CHARACTER_CARD_SIZE_BYTES) {
      const validation = {
        valid: false,
        errors: [`Character card file exceeds ${MAX_CHARACTER_CARD_SIZE_BYTES} bytes.`],
        warnings: [],
      };
      store.setCardParsed(null, validation, null);
      return { success: false, validation, sessionId: activeSessionId };
    }

    const text = await file.text();
    const { card, rawCard, validation } = parseCharacterCardV2(text);

    if (!card) {
      store.setCardParsed(null, validation, null);
      return { success: false, validation, sessionId: activeSessionId };
    }

    const sourceManifest = createCharacterCardSourceManifest({
      sourceFile: file.name,
      rawJson: text,
      rawCard: rawCard ?? {},
      normalizedCard: card,
    });

    store.setCardParsed(card, validation, sourceManifest);
    return { success: true, validation, card, sourceManifest, sessionId: activeSessionId };
  }, [store]);

  const mapRules = useCallback(async (
    manifest: CharacterCardSourceManifest,
  ) => {
    let nextManifest = manifest;

    if (manifest.normalizedCard.data.character_book?.entries.length) {
      const book = manifest.normalizedCard.data.character_book;
      const entries = book.entries
        .filter((entry) => entry.enabled)
        .map((entry, index) => ({
          index,
          name: entry.name?.trim() || entry.keys[0]?.trim() || `entry_${index}`,
          content: entry.content,
        }));

      let classifications: LorebookClassification[] = createFallbackClassifications(book);
      let classificationSource: CharacterCardSourceManifest['characterBookEntries'][number]['classificationSource'] = 'fallback';

      if (entries.length > 0) {
        try {
          const aiClient = createForgeAiClient();
          const classPrompt = buildClassificationPrompt(
            manifest.normalizedCard.data.name,
            entries,
          );
          const classResult = await aiClient.generateText({
            prompt: classPrompt,
            maxTokens: 4096,
            temperature: 0.2,
          });
          const parsed = parseClassificationResponse(classResult.text)
            .filter((classification) => classification.entryIndex >= 0);
          if (parsed.length > 0) {
            classifications = parsed;
            classificationSource = 'llm';
          }
        } catch {
          classificationSource = 'fallback';
        }
      }

      nextManifest = {
        ...manifest,
        characterBookEntries: createCharacterBookManifestEntries(
          book,
          classifications,
          classificationSource,
        ),
      };
      store.setCardParsed(nextManifest.normalizedCard, store.cardImport.validation ?? {
        valid: true,
        errors: [],
        warnings: [],
      }, nextManifest);
    }

    const mapped = mapManifestToRuleDrafts(nextManifest);
    store.setCardMapped(mapped.agentRules, mapped.worldRules);
    return { ...mapped, sourceManifest: nextManifest };
  }, [store]);

  const remapFromSourceManifest = useCallback(() => {
    const manifest = useImportSessionStore.getState().cardImport.sourceManifest;
    if (!manifest) {
      return null;
    }
    const mapped = mapManifestToRuleDrafts(manifest);
    store.setCardMapped(mapped.agentRules, mapped.worldRules);
    return mapped;
  }, [store]);

  const updateEntryClassification = useCallback((
    entryIndex: number,
    patch: Partial<LorebookClassification>,
  ) => {
    store.updateCardEntryClassification(entryIndex, patch);
    return remapFromSourceManifest();
  }, [remapFromSourceManifest, store]);

  const publish = useCallback(async (
    params: {
      characterName: string;
      targetWorldId: string | null;
      ownerType: 'MASTER_OWNED' | 'WORLD_OWNED';
      onProgress?: (progress: PublishProgress) => void;
    },
  ): Promise<PublishResult> => {
    store.setCardStep('PUBLISHING');

    const result = await publishCharacterCardImport({
      characterName: params.characterName,
      agentRules: store.cardImport.mappedAgentRules,
      worldRules: store.cardImport.mappedWorldRules,
      targetWorldId: params.targetWorldId,
      ownerType: params.ownerType,
      onProgress: params.onProgress,
    });

    return result;
  }, [store]);

  return {
    // State
    sessionId: store.sessionId,
    card: store.cardImport.card,
    validation: store.cardImport.validation,
    mappedAgentRules: store.cardImport.mappedAgentRules,
    mappedWorldRules: store.cardImport.mappedWorldRules,
    sourceManifest: store.cardImport.sourceManifest,
    step: store.cardImport.step,
    targetWorldId: store.targetWorldId,

    // Actions
    loadFile,
    mapRules,
    setStep: store.setCardStep,
    updateAgentRule: store.updateCardAgentRule,
    updateWorldRule: store.updateCardWorldRule,
    updateEntryClassification,
    remapFromSourceManifest,
    setTarget: store.setTarget,
    publish,
    reset: store.resetSession,
  };
}
