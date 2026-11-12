import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight, LoaderCircle } from 'lucide-react';
import { InlineAlert } from '@nimiplatform/kit/ui';
import { invokeChecked } from '../../bridge/runtime-bridge/invoke.js';
const zhiyuIcon = new URL('../../../../../../zhiyu/src/shell/assets/app-icon.png', import.meta.url).href;

// @nimi-authority: rule.nimi.platform.product-lifecycle.p-pkgrel-009
export function BundledZhiyuEntry() {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const open = async () => {
    setBusy(true); setFailed(false);
    try {
      await invokeChecked('bundled_zhiyu_open', {}, value => {
        if (!value || typeof value !== 'object' || !('opened' in value) || value.opened !== true) throw new Error('bundled-zhiyu-open-invalid');
        return value;
      });
    } catch { setFailed(true); } finally { setBusy(false); }
  };
  return <div className="flex flex-col gap-2" data-testid="bundled-zhiyu">
    <button type="button" disabled={busy} onClick={() => void open()} aria-label={t('Apps.bundled.openZhiyu')}
      className="flex w-full items-center gap-3 rounded-2xl px-3 py-2 text-left transition-colors hover:bg-[var(--nimi-surface-active)] focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)] disabled:opacity-60">
      <img src={zhiyuIcon} alt="" className="size-12 rounded-xl" />
      <span className="min-w-0 flex-1"><span className="block text-sm font-medium">{t('Apps.bundled.zhiyu')}</span>
        <span className="block text-xs text-[var(--nimi-text-secondary)]">{t('Apps.bundled.zhiyuDescription')}</span></span>
      {busy ? <LoaderCircle size={16} className="animate-spin" /> : <ChevronRight size={16} />}
    </button>
    {failed && <InlineAlert tone="warning">{t('Apps.bundled.openFailed')}</InlineAlert>}
  </div>;
}
