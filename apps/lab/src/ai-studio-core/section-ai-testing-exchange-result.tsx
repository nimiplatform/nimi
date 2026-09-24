import { useAIStudioHost } from './host-context.js';
import type { StudioTextExchangeItem, StudioTypedOutput } from './runtime-types.js';
import { TextStudioOutputBody } from './section-ai-testing-output.js';

type TextExchangeOutput = Extract<StudioTypedOutput, { kind: 'text-exchange' }>;

// Shows every ordered item exactly as exchanged, including opaque reasoning
// continuity (by size only) and the App's tool results.
export function TextExchangeResultView({ output }: { readonly output: TextExchangeOutput }) {
  const { translate: t } = useAIStudioHost();
  return (
    <section className="studio-result__rich" aria-label={t('StudioResults.exchange.title')}>
      <p className="studio-result__plain">
        {t(output.scenario === 'tool-call' ? 'StudioResults.exchange.toolScenario' : 'StudioResults.exchange.structuredScenario')}
      </p>
      <ol className="studio-exchange">
        {output.steps.map((step, index) => (
          <li key={index} className="studio-exchange__step">
            <strong>
              {t(step.origin === 'model' ? 'StudioResults.exchange.modelStep' : 'StudioResults.exchange.appStep', { index: index + 1 })}
              {step.finishReason ? ` · ${t('StudioResults.exchange.finishReason', { reason: step.finishReason })}` : ''}
            </strong>
            <ol className="studio-exchange__items">
              {step.items.map((item, itemIndex) => (
                <li key={itemIndex}><TextExchangeItemView item={item} /></li>
              ))}
            </ol>
          </li>
        ))}
      </ol>
      {output.structured !== undefined ? (
        <div>
          <strong>{t('StudioResults.exchange.structured')}</strong>
          <pre className="studio-diag__json">{JSON.stringify(output.structured, null, 2)}</pre>
        </div>
      ) : null}
      <strong>{t('StudioResults.exchange.finalText')}</strong>
      <TextStudioOutputBody text={output.text} />
    </section>
  );
}

function TextExchangeItemView({ item }: { readonly item: StudioTextExchangeItem }) {
  const { translate: t } = useAIStudioHost();
  if (item.type === 'text') {
    return <><span className="studio-exchange__kind">{t('StudioResults.exchange.text')}</span><p className="studio-exchange__text">{item.text}</p></>;
  }
  if (item.type === 'reasoning-continuity') {
    return (
      <span className="studio-exchange__kind">
        {t('StudioResults.exchange.continuity', { kind: item.carrierKind, version: item.version, bytes: item.payloadBytes })}
      </span>
    );
  }
  if (item.type === 'tool-call') {
    return (
      <>
        <span className="studio-exchange__kind">{t('StudioResults.exchange.toolCall', { name: item.toolName, id: item.toolCallId })}</span>
        <pre className="studio-diag__json">{JSON.stringify(item.arguments, null, 2)}</pre>
      </>
    );
  }
  return (
    <>
      <span className="studio-exchange__kind">
        {t(item.isError ? 'StudioResults.exchange.toolError' : 'StudioResults.exchange.toolResult', { name: item.toolName, id: item.toolCallId })}
      </span>
      <pre className="studio-diag__json">{JSON.stringify(item.result, null, 2)}</pre>
    </>
  );
}
