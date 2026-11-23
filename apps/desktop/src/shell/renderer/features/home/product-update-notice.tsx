import { IconButton, Tooltip } from '@nimiplatform/kit/ui';
import { RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  SHELL_CHROME_INTERACTIVE_RADIUS_CLASS,
  SHELL_CHROME_RAIL_ICON_SIZE,
  SHELL_CHROME_RAIL_ICON_STROKE_WIDTH,
  SHELL_CHROME_RAIL_ITEM_SIZE_CLASS,
  SHELL_CHROME_TOOLTIP_CLASS,
} from '../../app-shell/layouts/shell-chrome-classes.js';
import { useProductUpdate } from './product-update-context.js';

// @nimi-authority: rule.nimi.platform.product-lifecycle.p-supd-002
export function ProductUpdateNotice() {
  const { t } = useTranslation();
  const update = useProductUpdate();
  if (!update.railVisible) return null;
  const actionPending = update.attention || update.status?.phase === 'prepared';
  return (
    <Tooltip content={update.message} placement="right" contentClassName={SHELL_CHROME_TOOLTIP_CLASS}>
      <div className="relative">
        <IconButton data-testid="nimi-product-update" size="sm"
          className={`${SHELL_CHROME_RAIL_ITEM_SIZE_CLASS} ${SHELL_CHROME_INTERACTIVE_RADIUS_CLASS} ${update.attention ? 'text-[var(--nimi-status-danger)]' : 'text-[var(--nimi-action-primary-bg)]'}`}
          aria-label={t('ProductUpdate.update')} aria-haspopup="dialog" onClick={update.open}
          icon={<RefreshCw size={SHELL_CHROME_RAIL_ICON_SIZE} strokeWidth={SHELL_CHROME_RAIL_ICON_STROKE_WIDTH} aria-hidden="true" className={update.busy ? 'animate-spin motion-reduce:animate-none' : ''} />} />
        {actionPending ? (
          <span aria-hidden="true" className={`pointer-events-none absolute right-1 top-1 h-2 w-2 rounded-full border-2 border-[color:var(--nimi-surface-canvas)] ${
            update.attention ? 'bg-[var(--nimi-status-danger)]' : 'bg-[var(--nimi-action-primary-bg)]'}`} />
        ) : null}
      </div>
    </Tooltip>
  );
}
