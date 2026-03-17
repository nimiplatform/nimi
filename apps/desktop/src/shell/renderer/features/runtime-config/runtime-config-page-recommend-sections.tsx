import { useTranslation } from 'react-i18next';
import type {
  LocalRuntimeRecommendationFeedItemDescriptor,
} from '@runtime/local-runtime';
import { Button, Card } from './runtime-config-primitives';
import {
  RecommendationDetailList,
  RecommendationDiagnosticsPanel,
  recommendationBaselineLabel,
  recommendationConfidenceLabel,
  recommendationHostSupportLabel,
  recommendationReasonLabel,
  recommendationSummary,
  recommendationTierClass,
  recommendationTierLabel,
} from './runtime-config-local-model-center-helpers';

function topReasonLabel(item: LocalRuntimeRecommendationFeedItemDescriptor): string {
  const firstReason = item.recommendation?.reasonCodes.find((value) => value.trim());
  return firstReason ? recommendationReasonLabel(firstReason) : '';
}

export function FeedItemCard(props: {
  item: LocalRuntimeRecommendationFeedItemDescriptor;
  runtimeWritesDisabled: boolean;
  loadingPlan: boolean;
  loadingVariants: boolean;
  installing: boolean;
  onReviewPlan: (item: LocalRuntimeRecommendationFeedItemDescriptor) => void;
  onOpenVariants: (item: LocalRuntimeRecommendationFeedItemDescriptor) => void;
  onOpenLocalModels: (item: LocalRuntimeRecommendationFeedItemDescriptor) => void;
}) {
  const { t } = useTranslation();
  const recommendation = props.item.recommendation;

  return (
    <Card className="overflow-hidden rounded-[24px] border border-slate-200/70 bg-white/95 p-5 shadow-[0_18px_48px_rgba(15,23,42,0.08)]">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate text-base font-semibold text-slate-900">{props.item.title}</p>
              {props.item.verified ? (
                <span className="rounded-full bg-mint-100 px-2 py-0.5 text-[10px] font-medium text-mint-700">
                  {t('runtimeConfig.recommend.verified', { defaultValue: 'Verified' })}
                </span>
              ) : null}
              {recommendation ? (
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${recommendationTierClass(recommendation.tier)}`}>
                  {recommendationTierLabel(recommendation.tier)}
                </span>
              ) : null}
            </div>
            <p className="mt-1 text-xs text-slate-500">{props.item.repo}</p>
            {props.item.description ? (
              <p className="mt-2 line-clamp-2 text-sm text-slate-600">{props.item.description}</p>
            ) : null}
          </div>
          <div className="flex flex-wrap justify-end gap-2 text-[11px]">
            <span className="rounded-full bg-slate-100 px-2.5 py-1 font-medium text-slate-700">
              {recommendationHostSupportLabel(recommendation?.hostSupportClass)}
            </span>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 font-medium text-slate-700">
              {recommendationConfidenceLabel(recommendation?.confidence)}
            </span>
          </div>
        </div>

        <div className="grid gap-3 text-xs text-slate-600 md:grid-cols-2">
          <div className="rounded-2xl bg-slate-50 px-3 py-2">
            <p className="font-medium text-slate-700">{t('runtimeConfig.recommend.summary', { defaultValue: 'Summary' })}</p>
            <p className="mt-1 leading-5">{recommendationSummary(recommendation)}</p>
          </div>
          <div className="rounded-2xl bg-slate-50 px-3 py-2">
            <p className="font-medium text-slate-700">{t('runtimeConfig.recommend.bestEntry', { defaultValue: 'Best entry' })}</p>
            <p className="mt-1 font-mono text-[11px] text-slate-600">
              {recommendation?.recommendedEntry || props.item.installPayload.entry || t('runtimeConfig.recommend.entryPending', { defaultValue: 'Review plan to pick an entry.' })}
            </p>
            {topReasonLabel(props.item) ? (
              <p className="mt-2 leading-5 text-slate-500">{topReasonLabel(props.item)}</p>
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
          {props.item.downloads ? (
            <span>{t('runtimeConfig.recommend.downloads', { count: props.item.downloads, defaultValue: '{{count}} downloads' })}</span>
          ) : null}
          {typeof props.item.likes === 'number' ? (
            <span>{t('runtimeConfig.recommend.likes', { count: props.item.likes, defaultValue: '{{count}} likes' })}</span>
          ) : null}
          {props.item.formats.length > 0 ? (
            <span>{props.item.formats.join(' · ')}</span>
          ) : null}
          {recommendation?.baseline ? (
            <span>{recommendationBaselineLabel(recommendation.baseline)}</span>
          ) : null}
        </div>

        <RecommendationDetailList
          recommendation={recommendation}
          className="space-y-1"
          rowClassName="text-[11px] text-slate-500"
          labelClassName="font-medium text-slate-700"
          valueClassName="text-slate-600"
        />
        <RecommendationDiagnosticsPanel recommendation={recommendation} className="mt-0" />

        <div className="flex flex-wrap items-center gap-2 pt-1">
          {props.item.installedState.installed ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => props.onOpenLocalModels(props.item)}
            >
              {t('runtimeConfig.recommend.openLocalModels', { defaultValue: 'Open in Local Models' })}
            </Button>
          ) : (
            <>
              <Button
                size="sm"
                disabled={!props.item.actionState.canReviewInstallPlan || props.loadingPlan}
                onClick={() => props.onReviewPlan(props.item)}
              >
                {props.loadingPlan
                  ? t('runtimeConfig.recommend.reviewingPlan', { defaultValue: 'Reviewing…' })
                  : t('runtimeConfig.recommend.reviewInstallPlan', { defaultValue: 'Review Install Plan' })}
              </Button>
              {props.item.actionState.canOpenVariants ? (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={props.loadingVariants}
                  onClick={() => props.onOpenVariants(props.item)}
                >
                  {props.loadingVariants
                    ? t('runtimeConfig.recommend.loadingVariants', { defaultValue: 'Loading variants…' })
                    : t('runtimeConfig.recommend.openVariants', { defaultValue: 'Open Variants' })}
                </Button>
              ) : null}
            </>
          )}
          {props.item.installedState.installed ? (
            <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-medium text-emerald-700">
              {t('runtimeConfig.recommend.installedState', { defaultValue: 'Already installed' })}
            </span>
          ) : props.installing ? (
            <span className="rounded-full bg-mint-100 px-2.5 py-1 text-[11px] font-medium text-mint-700">
              {t('runtimeConfig.recommend.installing', { defaultValue: 'Installing…' })}
            </span>
          ) : props.runtimeWritesDisabled ? (
            <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-medium text-amber-700">
              {t('runtimeConfig.recommend.readOnly', { defaultValue: 'Read-only mode' })}
            </span>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

export function RecommendationSection(props: {
  title: string;
  eyebrow: string;
  emptyMessage: string;
  items: LocalRuntimeRecommendationFeedItemDescriptor[];
  runtimeWritesDisabled: boolean;
  loadingPlanItemId: string;
  loadingVariantsItemId: string;
  installingItemId: string;
  onReviewPlan: (item: LocalRuntimeRecommendationFeedItemDescriptor) => void;
  onOpenVariants: (item: LocalRuntimeRecommendationFeedItemDescriptor) => void;
  onOpenLocalModels: (item: LocalRuntimeRecommendationFeedItemDescriptor) => void;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-mint-600">{props.eyebrow}</p>
          <h3 className="mt-1 text-lg font-semibold text-slate-900">{props.title}</h3>
        </div>
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600">
          {props.items.length}
        </span>
      </div>
      {props.items.length === 0 ? (
        <Card className="rounded-[22px] border border-dashed border-slate-200 bg-slate-50/80 p-5 text-sm text-slate-500">
          {props.emptyMessage}
        </Card>
      ) : (
        <div className="space-y-3">
          {props.items.map((item) => (
            <FeedItemCard
              key={item.itemId}
              item={item}
              runtimeWritesDisabled={props.runtimeWritesDisabled}
              loadingPlan={props.loadingPlanItemId === item.itemId}
              loadingVariants={props.loadingVariantsItemId === item.itemId}
              installing={props.installingItemId === item.itemId}
              onReviewPlan={props.onReviewPlan}
              onOpenVariants={props.onOpenVariants}
              onOpenLocalModels={props.onOpenLocalModels}
            />
          ))}
        </div>
      )}
    </section>
  );
}
