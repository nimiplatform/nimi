import { useMemo } from 'react';
import { i18n } from '@renderer/i18n';
import {
  CODEGEN_T0_CAPABILITY_PATTERNS,
  CODEGEN_T1_CAPABILITY_PATTERNS,
  CODEGEN_T2_CAPABILITY_PATTERNS,
} from '@runtime/mod';

export function ModCodegenCapabilityPanel() {
  const sections = useMemo(() => ([
    {
      title: i18n.t('ModCodegen.t0AutoGrant', { defaultValue: 'T0 Auto Grant' }),
      color: 'text-emerald-700',
      items: [...CODEGEN_T0_CAPABILITY_PATTERNS],
    },
    {
      title: i18n.t('ModCodegen.t1ConsentRequired', { defaultValue: 'T1 Consent Required' }),
      color: 'text-amber-700',
      items: [...CODEGEN_T1_CAPABILITY_PATTERNS],
    },
    {
      title: i18n.t('ModCodegen.t2HardDeny', { defaultValue: 'T2 Hard Deny' }),
      color: 'text-rose-700',
      items: [...CODEGEN_T2_CAPABILITY_PATTERNS],
    },
  ]), []);

  return (
    <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-gray-900">
        {i18n.t('ModCodegen.catalogTitle', { defaultValue: 'Mod Codegen Capability Catalog' })}
      </h2>
      <p className="text-xs text-gray-500">
        {i18n.t('ModCodegen.catalogDescription', {
          defaultValue: 'Codegen mods use dedicated `sourceType=codegen` policy: T0 auto-grant, T1 requires consent, T2 hard-deny.',
        })}
      </p>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        {sections.map((section) => (
          <div key={section.title} className="rounded-lg border border-gray-200 p-3">
            <h3 className={`mb-2 text-xs font-semibold ${section.color}`}>{section.title}</h3>
            <ul className="space-y-1">
              {section.items.map((item) => (
                <li key={item} className="break-all text-[11px] text-gray-700">{item}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

export default ModCodegenCapabilityPanel;
