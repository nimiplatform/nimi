import { useMemo, useState, type ReactNode } from 'react';
import type { ModelConfigOwnerContext } from '../types.js';
import { ConfigAccordionSection, ConfigSection } from './config-section.js';
import { ModelConfigOwnerBoundary } from './model-config-owner-boundary.js';

export type ModelConfigSection = {
  readonly id: string;
  readonly title: string;
  readonly content: ReactNode;
  readonly hidden?: boolean;
  readonly collapsible?: boolean;
  readonly defaultExpanded?: boolean;
};

export type ModelConfigPanelProps = {
  readonly context: ModelConfigOwnerContext;
  readonly sections: readonly ModelConfigSection[];
  readonly className?: string;
};

export function ModelConfigPanel({ context, sections, className }: ModelConfigPanelProps) {
  const visible = useMemo(() => sections.filter((section) => !section.hidden), [sections]);
  const [expanded, setExpanded] = useState<string | null>(() => (
    visible.find((section) => section.collapsible && section.defaultExpanded)?.id
      ?? visible.find((section) => section.collapsible)?.id
      ?? null
  ));
  return (
    <ModelConfigOwnerBoundary context={context} className={className || 'space-y-1'}>
      {visible.map((section) => section.collapsible ? (
        <ConfigAccordionSection
          key={section.id}
          title={section.title}
          expanded={expanded === section.id}
          onToggle={() => setExpanded(expanded === section.id ? null : section.id)}
        >
          {section.content}
        </ConfigAccordionSection>
      ) : (
        <ConfigSection key={section.id} title={section.title}>{section.content}</ConfigSection>
      ))}
    </ModelConfigOwnerBoundary>
  );
}
