import { useEffect, useState } from 'react';
import type { NimiLocalAppTextAnnotationDocument, NimiLocalAppTextAnnotationResult } from '@nimiplatform/sdk/app';
import { useAIStudioHost } from './host-context.js';
import type { StudioTypedOutput } from './runtime-types.js';
import { readStudioTextAnnotationDocument } from './text-annotation-document.js';

type TextAnnotationOutput = Extract<StudioTypedOutput, { kind: 'text-annotation' }>;
type LoadState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly annotation: NimiLocalAppTextAnnotationResult }
  | { readonly status: 'unavailable'; readonly message: string };

// Large documents stay complete in the saved JSON; the view lists a bounded
// prefix of tokens per document.
const MAX_VISIBLE_TOKENS = 400;

export function TextAnnotationResultView({ output }: { readonly output: TextAnnotationOutput }) {
  const host = useAIStudioHost();
  const { translate: t } = host;
  const [state, setState] = useState<LoadState>(() => (
    output.annotation ? { status: 'ready', annotation: output.annotation } : { status: 'loading' }
  ));
  const { relativePath, mediaType, sizeBytes, sha256 } = output.document;
  useEffect(() => {
    if (output.annotation) {
      setState({ status: 'ready', annotation: output.annotation });
      return undefined;
    }
    // A restored history result is rebuilt on every render; only the saved
    // document identity selects a new read.
    let active = true;
    setState({ status: 'loading' });
    void readStudioTextAnnotationDocument(host.sdk.assets, {
      relativePath, sizeBytes, sha256, previewSource: 'managed-asset', ...(mediaType ? { mediaType } : {}),
    })
      .then((annotation) => { if (active) setState({ status: 'ready', annotation }); })
      .catch((cause: unknown) => {
        if (active) setState({ status: 'unavailable', message: cause instanceof Error ? cause.message : String(cause) });
      });
    return () => { active = false; };
  }, [host, output.annotation, relativePath, mediaType, sizeBytes, sha256]);

  return (
    <section className="studio-result__rich" aria-label={t('StudioResults.annotation.title')}>
      <p className="studio-result__plain">
        {t('StudioResults.annotation.summary', {
          language: output.language,
          documents: output.documentCount,
          tokens: output.tokenCount,
          sentences: output.sentenceCount,
        })}
      </p>
      <p className="studio-result__hint">{t('StudioResults.annotation.offsetHint')}</p>
      {state.status === 'loading' ? <p role="status">{t('StudioResults.annotation.loading')}</p> : null}
      {state.status === 'unavailable' ? (
        <div className="studio-result__blocked" role="alert">
          <p>{t('StudioResults.annotation.unavailable')}</p>
          <p className="studio-result__hint">{state.message}</p>
        </div>
      ) : null}
      {state.status === 'ready' ? state.annotation.documents.map((document, index) => (
        <TextAnnotationDocumentView key={index} index={index} document={document} />
      )) : null}
    </section>
  );
}

function TextAnnotationDocumentView({ index, document }: { readonly index: number; readonly document: NimiLocalAppTextAnnotationDocument }) {
  const { translate: t } = useAIStudioHost();
  const visibleTokens = Math.min(document.tokens.length, MAX_VISIBLE_TOKENS);
  return (
    <details className="studio-annotation" open={index === 0}>
      <summary>
        {t('StudioResults.annotation.document', {
          index: index + 1,
          tokens: document.tokens.length,
          sentences: document.sentences.length,
          scalars: Array.from(document.text).length,
        })}
      </summary>
      <p className="studio-annotation__text">{document.text}</p>
      {document.sentences.map((sentence, sentenceIndex) => {
        if (sentence.startToken >= visibleTokens) return null;
        const tokens = document.tokens.slice(sentence.startToken, Math.min(sentence.endToken, visibleTokens));
        return (
          <div key={sentenceIndex} className="studio-annotation__sentence">
            <strong>{t('StudioResults.annotation.sentence', { index: sentenceIndex + 1 })}</strong>
            <table className="studio-annotation__tokens">
              <thead>
                <tr>
                  <th>#</th>
                  <th>{t('StudioResults.annotation.token')}</th>
                  <th>{t('StudioResults.annotation.span')}</th>
                  <th>{t('StudioResults.annotation.partOfSpeech')}</th>
                  <th>{t('StudioResults.annotation.dependency')}</th>
                  <th>{t('StudioResults.annotation.head')}</th>
                </tr>
              </thead>
              <tbody>
                {tokens.map((token, offset) => {
                  const tokenIndex = sentence.startToken + offset;
                  return (
                    <tr key={tokenIndex}>
                      <td>{tokenIndex}</td>
                      <td><code>{token.text}</code>{token.isPunctuation ? ` · ${t('StudioResults.annotation.punctuation')}` : ''}</td>
                      <td><code>{`[${token.start}, ${token.end})`}</code></td>
                      <td>{token.partOfSpeech}</td>
                      <td>{token.dependency}</td>
                      <td>{token.headIndex}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })}
      {document.tokens.length > visibleTokens ? (
        <p className="studio-result__hint">{t('StudioResults.annotation.truncatedView', { shown: visibleTokens, total: document.tokens.length })}</p>
      ) : null}
    </details>
  );
}
