import { OPENROUTER_AUDIO_CHAT_MODELS } from './presets';
import { isLikelyAudioChatModel, isLikelyEmbeddingModel, isLikelyImageModel, isLikelySttModel, isLikelyTtsModel, isLikelyVideoModel, } from './classify';
function dedupeModelIds(models) {
    return Array.from(new Set(models.map((model) => String(model || '').trim()).filter(Boolean)));
}
export function filterModelOptions(models, query) {
    const normalizedQuery = String(query || '').trim().toLowerCase();
    if (!normalizedQuery)
        return models;
    return models.filter((model) => String(model || '').toLowerCase().includes(normalizedQuery));
}
export function filterModelsForScenario(models, scenario, options) {
    const all = dedupeModelIds(models);
    if (all.length === 0)
        return all;
    if (scenario === 'tts') {
        const ttsModels = all.filter((model) => isLikelyTtsModel(model));
        if (ttsModels.length > 0)
            return ttsModels;
        if (String(options?.vendor || '').trim() === 'openrouter') {
            return [...OPENROUTER_AUDIO_CHAT_MODELS];
        }
        return [];
    }
    if (scenario === 'stt') {
        return all.filter((model) => isLikelySttModel(model));
    }
    if (scenario === 'embedding') {
        return all.filter((model) => isLikelyEmbeddingModel(model));
    }
    if (scenario === 'image') {
        return all.filter((model) => isLikelyImageModel(model));
    }
    if (scenario === 'video') {
        return all.filter((model) => isLikelyVideoModel(model));
    }
    return all.filter((model) => (!isLikelyImageModel(model)
        && !isLikelyVideoModel(model)
        && !isLikelyTtsModel(model)
        && !isLikelySttModel(model)
        && !isLikelyEmbeddingModel(model)
        && !isLikelyAudioChatModel(model)));
}
export function filterModelsForSpeechSynthesis(models) {
    const all = dedupeModelIds(models);
    if (all.length === 0) {
        return all;
    }
    const ttsModels = all.filter((model) => isLikelyTtsModel(model));
    if (ttsModels.length > 0)
        return ttsModels;
    return [];
}
