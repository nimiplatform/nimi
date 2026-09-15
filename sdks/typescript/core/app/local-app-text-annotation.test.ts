import assert from 'node:assert/strict';
import test from 'node:test';
import { validateNimiLocalAppTextAnnotationResult } from './local-app-text-annotation.js';

function result() {
  return { documents: [{ text: ' 😀 hi ', language: 'en', tokens: [
    { text: '😀', start: 1, end: 2, headIndex: 1, partOfSpeech: 'INTJ', dependency: 'intj', isPunctuation: false },
    { text: 'hi', start: 3, end: 5, headIndex: 1, partOfSpeech: 'INTJ', dependency: 'ROOT', isPunctuation: false },
  ], sentences: [{ startToken: 0, endToken: 2 }] }, { text: '', language: 'en', tokens: [], sentences: [] }] };
}

test('annotation preserves Unicode scalar offsets and empty documents', () => {
  const input = result();
  assert.deepEqual(validateNimiLocalAppTextAnnotationResult(input), input);
  assert.ok(Object.isFrozen(validateNimiLocalAppTextAnnotationResult(input).documents[0]?.tokens));
});

test('annotation rejects wrong offsets, heads, sentence coverage, and authority fields', () => {
  const wrongOffset = result();
  wrongOffset.documents[0]!.tokens[0]!.end = 3;
  assert.throws(() => validateNimiLocalAppTextAnnotationResult(wrongOffset));
  const wrongHead = result();
  wrongHead.documents[0]!.tokens[0]!.headIndex = 2;
  assert.throws(() => validateNimiLocalAppTextAnnotationResult(wrongHead));
  const noSentence = result();
  noSentence.documents[0]!.sentences = [];
  assert.throws(() => validateNimiLocalAppTextAnnotationResult(noSentence));
  assert.throws(() => validateNimiLocalAppTextAnnotationResult({ ...result(), modelId: 'private' }));
});

test('annotation accepts a complete document beyond the former byte and token limits', () => {
  const tokens = Array.from({ length: 9000 }, (_, i) => ({
    text: 'annotation', start: i * 11, end: i * 11 + 10, headIndex: 0,
    partOfSpeech: 'NOUN', dependency: 'dep', isPunctuation: false,
  }));
  const value = { documents: [{ text: tokens.map(t => t.text).join(' '), language: 'en', tokens,
    sentences: [{ startToken: 0, endToken: tokens.length }] }] };
  assert.equal(validateNimiLocalAppTextAnnotationResult(value).documents[0]?.tokens.length, 9000);
});
