/**
 * @generated
 * Source: runtime/catalog/providers/local.yaml
 *   sha256: 46ee521d5fd9b2d1676cf69df3aac8961380b35be11a8b051e28dd3b17c9811e
 * Generator: apps/web/scripts/generate-landing-data.mjs
 * DO NOT EDIT MANUALLY. Re-run generator (`pnpm prebuild` or
 * `node scripts/generate-landing-data.mjs` from apps/web/) to refresh.
 */

export type LocalCapabilityModel = {
  id: string;
  label: string;
  byo?: boolean;
};

export const LOCAL_MODEL_CATALOG: Readonly<Record<string, readonly LocalCapabilityModel[]>> = {
  "audio.separate": [
    {"id":"spleeter-2stems-local","label":"Spleeter 2 stems"},
    {"id":"spleeter-4stems-local","label":"Spleeter 4 stems"},
    {"id":"demucs-vocals-background","label":"Demucs","byo":true},
    {"id":"htdemucs.audio-cpp.v1","label":"HTDemucs","byo":true},
  ],
  "audio.speaker.embed": [
    {"id":"sherpa-speaker-encoder.v1","label":"Sherpa-ONNX Speaker Encoder","byo":true},
  ],
  "audio.synthesize": [
    {"id":"voxcpm2-local","label":"VoxCPM2"},
    {"id":"qwen3-tts-local","label":"Qwen3-TTS CustomVoice"},
    {"id":"qwen3-tts-base-local","label":"Qwen3-TTS Base"},
    {"id":"qwen3-tts-voicedesign-local","label":"Qwen3-TTS VoiceDesign"},
    {"id":"chatterbox-audio-cpp-local","label":"Chatterbox"},
    {"id":"confucius4-tts-audio-cpp-local","label":"Confucius4-TTS"},
    {"id":"dots-tts-audio-cpp-local","label":"DotTTS"},
    {"id":"dramabox-audio-cpp-local","label":"DramaBox"},
    {"id":"fish-audio-audio-cpp-local","label":"Fish Audio S2 Pro"},
    {"id":"glm-tts-audio-cpp-local","label":"GLM-TTS"},
    {"id":"higgs-audio-tts-audio-cpp-local","label":"Higgs Audio v3 TTS"},
    {"id":"index-tts2-audio-cpp-local","label":"IndexTTS2"},
    {"id":"inflect-v2-audio-cpp-local","label":"Inflect Micro v2"},
    {"id":"irodori-tts-audio-cpp-local","label":"Irodori-TTS"},
    {"id":"miotts-audio-cpp-local","label":"MioTTS"},
    {"id":"moss-tts-local-audio-cpp-local","label":"MOSS-TTS-Local"},
    {"id":"moss-tts-nano-audio-cpp-local","label":"MOSS-TTS-Nano"},
    {"id":"neutts-audio-cpp-local","label":"NeuTTS"},
    {"id":"omnivoice-audio-cpp-local","label":"OmniVoice"},
    {"id":"outetts-audio-cpp-local","label":"Llama-OuteTTS 1.0"},
    {"id":"pocket-tts-audio-cpp-local","label":"PocketTTS"},
    {"id":"supertonic-audio-cpp-local","label":"Supertonic 3"},
    {"id":"vibevoice-audio-cpp-local","label":"VibeVoice"},
    {"id":"vietneu-tts-audio-cpp-local","label":"VieNeu-TTS v3 Turbo"},
    {"id":"minimax-h3-audio-cpp-tts-local","label":"MiniMax-H3 Dialogue"},
    {"id":"vevo2-audio-cpp-tts-local","label":"Vevo2"},
    {"id":"fish-drama3-small-audio-cpp-local","label":"Fish Audio Drama 3 Small"},
    {"id":"kitten-tts2-audio-cpp-local","label":"Kitten TTS 2"},
    {"id":"plapre3-audio-cpp-local","label":"Plapre 3 Danish"},
  ],
  "audio.transcribe": [
    {"id":"whisper-large-v3-turbo-local","label":"Whisper Large v3 Turbo"},
    {"id":"qwen3-asr-local","label":"Qwen3-ASR 0.6B"},
    {"id":"citrinet-asr-audio-cpp-local","label":"Citrinet ASR"},
    {"id":"fun-asr-nano-audio-cpp-local","label":"Fun-ASR-Nano"},
    {"id":"higgs-audio-stt-audio-cpp-local","label":"Higgs Audio v3 STT"},
    {"id":"hviske-asr-audio-cpp-local","label":"Hviske v5.3"},
    {"id":"kroko-asr-audio-cpp-local","label":"Kroko ASR English"},
    {"id":"nemotron-asr-audio-cpp-local","label":"Nemotron 3.5 ASR"},
    {"id":"parakeet-tdt-audio-cpp-local","label":"Parakeet-TDT 0.6B v3"},
    {"id":"qwen3-asr-audio-cpp-local","label":"Qwen3-ASR 1.7B"},
    {"id":"sense-asr-audio-cpp-local","label":"SenseVoice Small"},
    {"id":"vibevoice-asr-audio-cpp-local","label":"VibeVoice ASR"},
    {"id":"voxtral-realtime-audio-cpp-local","label":"Voxtral Realtime"},
  ],
  "audio.voice.convert": [
    {"id":"seed-vc.v1-svc.audio-cpp.v1","label":"Seed-VC","byo":true},
    {"id":"vevo2-audio-cpp-local","label":"VeVo2"},
  ],
  "image.face_swap": [
    {"id":"insightface.image-face-swap.v1","label":"InsightFace","byo":true},
    {"id":"hyperswap-1a.image-face-swap.v1","label":"HyperSwap 1a","byo":true},
  ],
  "image.generate": [
    {"id":"sdxl-base-1.0-local","label":"SDXL ControlNet Union ProMax"},
    {"id":"flux3-image-klein-local","label":"FLUX3 Klein"},
    {"id":"flux.1-schnell-local","label":"FLUX.1 Schnell"},
    {"id":"z-image-turbo-local","label":"Z-Image Turbo"},
    {"id":"ideogram4-local","label":"Ideogram4"},
    {"id":"qwen-image-local","label":"Qwen Image"},
    {"id":"minimax-h3-image-local","label":"MiniMax-H3-Image"},
    {"id":"qwen-image-edit-2511-local","label":"Qwen Image Edit 2511"},
  ],
  "image.upscale": [
    {"id":"relayvsr-2x-local","label":"RelayVSR 2x"},
    {"id":"relayvsr-4x-local","label":"RelayVSR 4x"},
    {"id":"seedvr2-3b-local","label":"SeedVR2 3B"},
    {"id":"seedvr2-7b-sharp-local","label":"SeedVR2 7B Sharp"},
  ],
  "music.generate": [
    {"id":"yue2-audio-cpp-local","label":"YuE2"},
    {"id":"minimax-music3-audio-cpp-local","label":"MiniMax-Music3"},
  ],
  "music.transcribe": [
    {"id":"basic-pitch-onnx-local","label":"Basic Pitch"},
    {"id":"sheetsage2-audio-cpp-local","label":"SheetSage2"},
  ],
  "text.annotate": [
    {"id":"asset-nlp-spacy-en-core-web-md-3.8.0","label":"spaCy en_core_web_md (English)"},
    {"id":"asset-nlp-spacy-en-core-web-trf-3.8.0","label":"spaCy en_core_web_trf (English)"},
    {"id":"asset-nlp-spacy-de-core-news-md-3.8.0","label":"spaCy de_core_news_md (German)"},
    {"id":"asset-nlp-spacy-es-core-news-md-3.8.0","label":"spaCy es_core_news_md (Spanish)"},
    {"id":"asset-nlp-spacy-fr-core-news-md-3.8.0","label":"spaCy fr_core_news_md (French)"},
    {"id":"asset-nlp-spacy-it-core-news-md-3.8.0","label":"spaCy it_core_news_md (Italian)"},
    {"id":"asset-nlp-spacy-ru-core-news-md-3.8.0","label":"spaCy ru_core_news_md (Russian)"},
    {"id":"asset-nlp-spacy-zh-core-web-md-3.8.0","label":"spaCy zh_core_web_md (Chinese)"},
    {"id":"asset-nlp-spacy-ja-core-news-md-3.8.0","label":"spaCy ja_core_news_md (Japanese)"},
    {"id":"asset-nlp-spacy-de-dep-news-trf-3.8.0","label":"spaCy de_dep_news_trf (German)"},
    {"id":"asset-nlp-spacy-zh-core-web-trf-3.8.0","label":"spaCy zh_core_web_trf (Chinese)"},
  ],
  "text.decide": [
    {"id":"asset-decision-laya-typed-decisions","label":"Laya typed decisions (English)"},
    {"id":"asset-decision-laya-multilingual","label":"Laya multilingual decisions"},
    {"id":"asset-decision-laya-browser-v10s","label":"Laya browser steps (v10s)"},
  ],
  "text.embed": [
    {"id":"nomic-embed-text-local","label":"Nomic Embed Text v1.5"},
    {"id":"qwen3-embedding-0.6b-local","label":"Qwen3 Embedding 0.6B"},
    {"id":"embeddinggemma-2-text-local","label":"EmbeddingGemma 2"},
  ],
  "text.generate": [
    {"id":"gemma-4-e2b-it-local","label":"Gemma 4 E2B IT"},
    {"id":"gemma-4-26b-a4b-it-local","label":"Gemma 4 26B A4B IT"},
    {"id":"qwen3.5-4b-local","label":"Qwen3.5 4B"},
    {"id":"qwen3.8-27b-local","label":"Qwen3.8 27B"},
    {"id":"lfm3-1.7b-local","label":"LFM3 1.7B"},
    {"id":"gemma-4-12b-unified-local","label":"Gemma 4 12B Unified"},
  ],
  "video.face_swap": [
    {"id":"insightface.video-face-swap.v1","label":"InsightFace","byo":true},
    {"id":"hyperswap-1a.video-face-swap.v1","label":"HyperSwap 1a","byo":true},
  ],
  "video.generate": [
    {"id":"wan2.2-ti2v-5b-local","label":"Wan2.2 TI2V 5B"},
    {"id":"hyperflow-h3-flash-fl2va-local","label":"HyperFlow H3 Flash"},
    {"id":"minimax-h3-fl2va-local","label":"MiniMax-H3"},
  ],
  "video.upscale": [
    {"id":"relayvsr-2x-local","label":"RelayVSR 2x"},
    {"id":"relayvsr-4x-local","label":"RelayVSR 4x"},
    {"id":"seedvr2-3b-local","label":"SeedVR2 3B"},
    {"id":"seedvr2-7b-sharp-local","label":"SeedVR2 7B Sharp"},
  ],
  "vision.locate": [
    {"id":"locateanything-local","label":"LocateAnything 3B"},
    {"id":"grounding-dino-tiny-local","label":"Grounding DINO Tiny"},
    {"id":"grounding-dino-base-local","label":"Grounding DINO Base"},
  ],
  "voice.create": [
    {"id":"qwen3-tts-base-local","label":"Qwen3-TTS Base"},
    {"id":"qwen3-tts-voicedesign-local","label":"Qwen3-TTS VoiceDesign"},
    {"id":"chatterbox-audio-cpp-local","label":"Chatterbox"},
    {"id":"confucius4-tts-audio-cpp-local","label":"Confucius4-TTS"},
    {"id":"dots-tts-audio-cpp-local","label":"DotTTS"},
    {"id":"dramabox-audio-cpp-local","label":"DramaBox"},
    {"id":"fish-audio-audio-cpp-local","label":"Fish Audio S2 Pro"},
    {"id":"glm-tts-audio-cpp-local","label":"GLM-TTS"},
    {"id":"higgs-audio-tts-audio-cpp-local","label":"Higgs Audio v3 TTS"},
    {"id":"index-tts2-audio-cpp-local","label":"IndexTTS2"},
    {"id":"irodori-tts-audio-cpp-local","label":"Irodori-TTS"},
    {"id":"miotts-audio-cpp-local","label":"MioTTS"},
    {"id":"moss-tts-local-audio-cpp-local","label":"MOSS-TTS-Local"},
    {"id":"moss-tts-nano-audio-cpp-local","label":"MOSS-TTS-Nano"},
    {"id":"omnivoice-audio-cpp-local","label":"OmniVoice"},
    {"id":"outetts-audio-cpp-local","label":"Llama-OuteTTS 1.0"},
    {"id":"pocket-tts-audio-cpp-local","label":"PocketTTS"},
    {"id":"vibevoice-audio-cpp-local","label":"VibeVoice"},
    {"id":"vietneu-tts-audio-cpp-local","label":"VieNeu-TTS v3 Turbo"},
    {"id":"voxcpm2-audio-cpp-local","label":"VoxCPM2"},
    {"id":"vevo2-audio-cpp-tts-local","label":"Vevo2"},
    {"id":"fish-drama3-small-audio-cpp-local","label":"Fish Audio Drama 3 Small"},
    {"id":"kitten-tts2-audio-cpp-local","label":"Kitten TTS 2"},
    {"id":"plapre3-audio-cpp-local","label":"Plapre 3 Danish"},
  ],
};
