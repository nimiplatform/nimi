import { useMemo, useState } from 'react';
import type { ModelConfigPanelProps } from '../types.js';
import { CapabilityModelCard } from './capability-model-card.js';
import { ConfigAccordionSection, ConfigSection } from './config-section.js';
import { ProfileConfigSection } from './profile-config-section.js';

function resolveInitialExpandedSectionId(sections: ModelConfigPanelProps['sections']): string | null {
  const explicit = sections.find((section) => section.collapsible && section.defaultExpanded && !section.hidden);
  if (explicit) {
    return explicit.id;
  }
  const firstCollapsible = sections.find((section) => section.collapsible && !section.hidden);
  return firstCollapsible?.id || null;
}

export function ModelConfigPanel({ className, profile, sections }: ModelConfigPanelProps) {
  const visibleSections = useMemo(
    () => sections.filter((section) => !section.hidden),
    [sections],
  );
  const [expandedSectionId, setExpandedSectionId] = useState<string | null>(() => resolveInitialExpandedSectionId(visibleSections));

  return (
    <div className={className || 'space-y-1'}>
      {profile ? (
        <ConfigSection title={profile.copy.sectionTitle}>
          <ProfileConfigSection controller={profile} />
        </ConfigSection>
      ) : null}

      {visibleSections.map((section) => {
        const content = (
          <div className="space-y-4">
            {section.items?.map((item) => (
              <CapabilityModelCard key={item.capabilityId} item={item} />
            ))}
            {section.content}
          </div>
        );

        if (section.collapsible) {
          const expanded = expandedSectionId === section.id;
          return (
            <ConfigAccordionSection
              key={section.id}
              title={section.title}
              expanded={expanded}
              onToggle={() => setExpandedSectionId(expanded ? null : section.id)}
            >
              {content}
            </ConfigAccordionSection>
          );
        }

        return (
          <ConfigSection key={section.id} title={section.title}>
            {content}
          </ConfigSection>
        );
      })}
    </div>
  );
}
