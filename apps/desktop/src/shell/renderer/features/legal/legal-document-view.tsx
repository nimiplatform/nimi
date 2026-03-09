import { useTranslation } from 'react-i18next';

type LegalSection = {
  title: string;
  paragraphs?: string[];
  bullets?: string[];
};

type LegalDocumentContent = {
  title: string;
  description: string;
  lastUpdatedLabel: string;
  lastUpdated: string;
  footer: string;
  sections: LegalSection[];
};

export function LegalDocumentView(props: { documentKey: 'terms' | 'privacy' }) {
  const { t } = useTranslation();
  const content = t(`Legal.${props.documentKey}`, { returnObjects: true }) as unknown as LegalDocumentContent;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-gray-50">
      <div className="mx-auto max-w-3xl px-6 py-10">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">{content.title}</h1>
          <p className="mt-2 text-sm text-gray-500">{content.lastUpdatedLabel}: {content.lastUpdated}</p>
          <p className="mt-4 text-sm leading-relaxed text-gray-600">{content.description}</p>
        </div>

        <div className="space-y-8 text-sm leading-relaxed text-gray-700">
          {content.sections.map((section, index) => (
            <section key={`${props.documentKey}-${index}`}>
              <h2 className="mb-3 text-lg font-semibold text-gray-900">{section.title}</h2>
              {section.paragraphs?.map((paragraph, paragraphIndex) => (
                <p key={paragraphIndex} className={paragraphIndex > 0 ? 'mt-2' : ''}>
                  {paragraph}
                </p>
              ))}
              {section.bullets?.length ? (
                <ul className="mt-2 list-disc space-y-1 pl-6">
                  {section.bullets.map((bullet, bulletIndex) => (
                    <li key={bulletIndex}>{bullet}</li>
                  ))}
                </ul>
              ) : null}
            </section>
          ))}
        </div>

        <div className="mt-12 border-t border-gray-200 pt-8 text-center text-xs text-gray-400">
          <p>{content.footer}</p>
        </div>
      </div>
    </div>
  );
}
