import { useTranslation } from 'react-i18next';
import type { NimiRuntimeLocalRecommendationFeedItem } from '@nimiplatform/sdk/runtime';
import { Button, SectionTitle } from './runtime-config-primitives';
import { formatBytes } from './runtime-config-model-center-utils';
import {
  computeVramPercentage,
  parseQuantBitsFromEntry,
  parseQuantLevelFromEntry,
  quantQualityColorClass,
  quantQualityLabel,
  vramPercentageColorClass,
} from './runtime-config-page-recommend-utils';

type RecommendQuantizationTableProps = {
  item: NimiRuntimeLocalRecommendationFeedItem;
  onReviewInstallPlan: (options?: { entry?: string; files?: string[]; hashes?: Record<string, string> }) => void;
  totalVramBytes?: number;
};

function formatSizeLabel(sizeBytes: number): string {
  return sizeBytes > 0 ? formatBytes(sizeBytes) : '\u2014';
}

export function RecommendQuantizationTable({
  item,
  onReviewInstallPlan,
  totalVramBytes,
}: RecommendQuantizationTableProps) {
  const { t } = useTranslation();
  const recommendation = item.recommendation;

  if (item.entries.length === 0) return null;

  return (
    <div>
      <SectionTitle>
        {t('runtimeConfig.recommend.quantTitle', { defaultValue: 'Quantization Options' })}
      </SectionTitle>
      <div className="mt-2 overflow-x-auto rounded-xl border border-[var(--nimi-border-subtle)]">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] text-xs">
              <th className="px-4 py-2.5 font-medium text-[var(--nimi-text-muted)]">{t('runtimeConfig.recommend.quantColQuant', { defaultValue: 'Quant' })}</th>
              <th className="px-4 py-2.5 font-medium text-[var(--nimi-text-muted)]">{t('runtimeConfig.recommend.quantColBits', { defaultValue: 'Bits' })}</th>
              <th className="px-4 py-2.5 font-medium text-[var(--nimi-text-muted)]">VRAM</th>
              <th className="px-4 py-2.5 font-medium text-[var(--nimi-text-muted)]">{t('runtimeConfig.recommend.quantColQuality', { defaultValue: 'Quality' })}</th>
              <th className="px-4 py-2.5 font-medium text-[var(--nimi-text-muted)]">{t('runtimeConfig.recommend.detailQuantStatus', { defaultValue: 'Status' })}</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {item.entries.map((entry) => {
              const quantLevel = parseQuantLevelFromEntry(entry.entry);
              const bits = parseQuantBitsFromEntry(entry.entry);
              const quality = quantQualityLabel(bits);
              const qualityColor = quantQualityColorClass(quality);
              const vramPct = computeVramPercentage(entry.totalSizeBytes, totalVramBytes);
              const isRecommended = recommendation?.recommendedEntry === entry.entry;
              return (
                <tr key={entry.entryId} className={`border-b border-[var(--nimi-border-subtle)] transition-colors hover:bg-[var(--nimi-surface-panel)] ${isRecommended ? 'bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_10%,transparent)]/30' : ''}`}>
                  <td className="px-4 py-3">
                    <span className="font-mono text-xs font-medium text-[var(--nimi-text-primary)]">{quantLevel || entry.entry}</span>
                    {isRecommended ? (
                      <span className="ml-2 rounded bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_16%,transparent)] px-1.5 py-0.5 text-[length:var(--nimi-type-caption-size)] font-bold text-[var(--nimi-action-primary-bg)]">
                        {t('runtimeConfig.recommend.quantBest', { defaultValue: 'BEST' })}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-xs text-[var(--nimi-text-secondary)]">{bits ?? '\u2014'}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-[var(--nimi-text-secondary)]">{formatSizeLabel(entry.totalSizeBytes)}</span>
                      {vramPct !== null ? (
                        <span className={`text-[length:var(--nimi-type-caption-size)] font-medium ${vramPercentageColorClass(vramPct)}`}>({vramPct}%)</span>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {quality ? (
                      <span className={`inline-block rounded-full px-2 py-0.5 text-[length:var(--nimi-type-caption-size)] font-semibold ${qualityColor}`}>{quality}</span>
                    ) : <span className="text-xs text-[var(--nimi-text-muted)]">{'\u2014'}</span>}
                  </td>
                  <td className="px-4 py-3 text-xs text-[var(--nimi-text-muted)]">{'\u2014'}</td>
                  <td className="px-4 py-3 text-right">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => onReviewInstallPlan({
                        entry: entry.entry,
                        files: [...entry.files],
                        hashes: entry.sha256 ? { [entry.entry]: entry.sha256 } : undefined,
                      })}
                    >
                      {t('runtimeConfig.recommend.quantReview', { defaultValue: 'Review' })}
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
