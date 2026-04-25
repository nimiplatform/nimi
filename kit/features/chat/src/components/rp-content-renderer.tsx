import { useMemo, type ReactNode } from 'react';
import { parseRpSegments, hasRpContent, type RpSegment } from '../utils/rp-content-parser.js';
import { ChatMarkdownRenderer } from './chat-markdown-renderer.js';

export type RpContentRendererProps = {
  content: string;
  appearance?: 'canonical';
};

const NARRATION_CLASS: Record<NonNullable<RpContentRendererProps['appearance']>, string> = {
  canonical: 'my-2 whitespace-pre-wrap text-[0.92em] italic leading-[1.7] text-gray-500',
};

function NarrationSegment(props: { text: string; appearance: NonNullable<RpContentRendererProps['appearance']> }) {
  return (
    <p className={NARRATION_CLASS[props.appearance]}>
      {props.text}
    </p>
  );
}

export function RpContentRenderer(props: RpContentRendererProps) {
  const appearance = props.appearance || 'canonical';

  const segments = useMemo(
    () => (hasRpContent(props.content) ? parseRpSegments(props.content) : null),
    [props.content],
  );

  if (!segments || segments.length === 0) {
    return <ChatMarkdownRenderer content={props.content} appearance={appearance} />;
  }

  if (segments.length === 1 && segments[0]!.kind === 'dialogue') {
    return <ChatMarkdownRenderer content={segments[0]!.text} appearance={appearance} />;
  }

  const nodes: ReactNode[] = [];
  for (let i = 0; i < segments.length; i++) {
    const segment: RpSegment = segments[i]!;
    if (segment.kind === 'narration') {
      nodes.push(
        <NarrationSegment key={`rp-${i}`} text={segment.text} appearance={appearance} />,
      );
    } else {
      nodes.push(
        <ChatMarkdownRenderer key={`rp-${i}`} content={segment.text} appearance={appearance} />,
      );
    }
  }

  return <>{nodes}</>;
}
