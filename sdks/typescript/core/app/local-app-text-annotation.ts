import { asRecord, assertExactProjectionKeys, localAppProjectionError } from './local-app-runtime-platform-validation.js';

export type NimiLocalAppTextAnnotationToken = {
  readonly text: string;
  /** Zero-based Unicode scalar offsets; end is exclusive. */
  readonly start: number;
  readonly end: number;
  readonly headIndex: number;
  readonly partOfSpeech: string;
  readonly dependency: string;
  readonly isPunctuation: boolean;
};

export type NimiLocalAppTextAnnotationDocument = {
  readonly text: string;
  readonly language: string;
  readonly tokens: readonly NimiLocalAppTextAnnotationToken[];
  readonly sentences: readonly { readonly startToken: number; readonly endToken: number }[];
};

export type NimiLocalAppTextAnnotationResult = {
  readonly documents: readonly NimiLocalAppTextAnnotationDocument[];
};

// @nimi-authority: rule.nimi.runtime.ai-provider.text-annotation
export function validateNimiLocalAppTextAnnotationResult(value: unknown): NimiLocalAppTextAnnotationResult {
  const root = asRecord(value);
  assertExactProjectionKeys(root, ['documents'], 'text annotation');
  if (!Array.isArray(root.documents) || root.documents.length < 1 || root.documents.length > 64) localAppProjectionError('annotation documents');
  let totalBytes = 0;
  let totalTokens = 0;
  let language: string | undefined;
  const documents = root.documents.map((value) => {
    const doc = asRecord(value);
    assertExactProjectionKeys(doc, ['text', 'language', 'tokens', 'sentences'], 'annotation document');
    if (typeof doc.text !== 'string' || /[\uD800-\uDFFF]/u.test(doc.text) || typeof doc.language !== 'string'
      || !/^[a-z-]{2,16}$/.test(doc.language) || (language !== undefined && doc.language !== language)
      || !Array.isArray(doc.tokens) || !Array.isArray(doc.sentences)) localAppProjectionError('annotation document');
    language = doc.language;
    totalBytes += new TextEncoder().encode(doc.text).byteLength;
    totalTokens += doc.tokens.length;
    if (totalBytes > 524288 || totalTokens > 65536 || (doc.text.length > 0 && doc.tokens.length === 0)) localAppProjectionError('annotation limit');
    const source = Array.from(doc.text);
    const tokenCount = doc.tokens.length;
    let end = 0;
    const tokens = doc.tokens.map((value) => {
      const token = asRecord(value);
      assertExactProjectionKeys(token, ['text', 'start', 'end', 'headIndex', 'partOfSpeech', 'dependency', 'isPunctuation'], 'annotation token');
      const start = index(token.start, source.length);
      const stop = index(token.end, source.length);
      const headIndex = index(token.headIndex, tokenCount - 1);
      if (start < end || stop <= start || token.text !== source.slice(start, stop).join('') || source.slice(end, start).join('').trim() !== ''
        || typeof token.isPunctuation !== 'boolean') localAppProjectionError('annotation token span');
      end = stop;
      return Object.freeze({ text: token.text as string, start, end: stop, headIndex,
        partOfSpeech: label(token.partOfSpeech), dependency: label(token.dependency), isPunctuation: token.isPunctuation });
    });
    if (source.slice(end).join('').trim() !== '') localAppProjectionError('annotation omitted source');
    end = 0;
    const sentences = doc.sentences.map((value) => {
      const sentence = asRecord(value);
      assertExactProjectionKeys(sentence, ['startToken', 'endToken'], 'annotation sentence');
      const startToken = index(sentence.startToken, tokens.length);
      const endToken = index(sentence.endToken, tokens.length);
      if (startToken !== end || endToken <= startToken) localAppProjectionError('annotation sentence coverage');
      end = endToken;
      return Object.freeze({ startToken, endToken });
    });
    if (end !== tokens.length) localAppProjectionError('annotation sentence coverage');
    return Object.freeze({ text: doc.text, language: doc.language, tokens: Object.freeze(tokens), sentences: Object.freeze(sentences) });
  });
  const result = Object.freeze({ documents: Object.freeze(documents) });
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > 16 * 1024 * 1024) localAppProjectionError('annotation result size');
  return result;
}

function index(value: unknown, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > max) localAppProjectionError('annotation index');
  return value;
}

function label(value: unknown): string {
  if (typeof value !== 'string' || !value || value.trim() !== value || /[\uD800-\uDFFF]/u.test(value) || new TextEncoder().encode(value).byteLength > 128) localAppProjectionError('annotation label');
  return value;
}
