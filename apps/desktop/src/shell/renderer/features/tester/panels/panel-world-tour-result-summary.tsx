import { useTranslation } from 'react-i18next';
import { Button, Surface } from '@nimiplatform/kit/ui';
import type {
  WorldFixturePackage,
  WorldInspectRenderPlan,
  WorldInspectSession,
} from '@nimiplatform/sdk/world';
import { E2E_IDS } from '@renderer/testability/e2e-ids';
import { ErrorBox, InfoBox } from '../tester-diagnostics.js';
import {
  resolveWorldTourAssetUrl,
  type ResolvedWorldTourFixture,
} from '../world-tour-shared';

type WorldResultSummaryProps = {
  world: WorldFixturePackage;
  renderPlan: WorldInspectRenderPlan | null;
  sessionState: WorldInspectSession | null;
  fixture: ResolvedWorldTourFixture | null;
  launchBusy: boolean;
  launchStatus: string;
  launchError: string;
  onLaunch: () => void;
};

export function WorldResultSummary(props: WorldResultSummaryProps) {
  const { t } = useTranslation();
  const previewImage = resolveWorldTourAssetUrl(
    props.renderPlan?.previewImageLocalPath || props.fixture?.thumbnailLocalPath || props.world.thumbnailLocalPath,
    props.renderPlan?.previewImageUrl || props.fixture?.thumbnailRemoteUrl || props.world.thumbnailUrl || props.world.panoUrl,
  );
  const semantics = props.world.semanticsMetadata;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs text-[var(--nimi-text-secondary)]">
          {t('Tester.worldTour.launchOnlyNotice', {
            defaultValue: 'Tester is now launch-only for world browsing. Heavy Spark lifecycle moved into the dedicated desktop world-tour window.',
          })}
        </div>
        <Button
          data-testid={E2E_IDS.worldTourLaunchButton}
          tone="secondary"
          size="sm"
          disabled={!props.fixture || props.launchBusy}
          onClick={props.onLaunch}
        >
          {props.launchBusy
            ? t('Tester.worldTour.launching', { defaultValue: 'Launching...' })
            : t('Tester.worldTour.launchButton', { defaultValue: 'Launch World Tour' })}
        </Button>
      </div>
      {props.launchStatus ? <InfoBox message={props.launchStatus} /> : null}
      {props.launchError ? <ErrorBox message={props.launchError} /> : null}

      {previewImage ? (
        <div className="flex flex-col gap-2">
          <div className="text-xs font-semibold text-[var(--nimi-text-secondary)]">
            {t('Tester.worldTour.fixtureImagery', { defaultValue: 'Fixture imagery' })}
          </div>
          <div className="overflow-hidden rounded-[var(--nimi-radius-md)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-canvas)]">
            <img
              src={previewImage}
              alt={t('Tester.worldTour.worldPreviewAlt', { defaultValue: 'World preview' })}
              className="block max-h-[320px] w-full object-cover"
            />
          </div>
        </div>
      ) : null}

      <Surface tone="card" padding="sm" className="flex flex-col gap-1 text-xs text-[var(--nimi-text-secondary)]">
        <div className="font-semibold text-[var(--nimi-text-primary)]">
          {t('Tester.worldTour.worldResult', { defaultValue: 'World result' })}
        </div>
        {props.world.worldId ? (
          <div>
            {t('Tester.worldTour.worldIdLabel', { defaultValue: 'world id:' })}{' '}
            <span className="font-mono text-[var(--nimi-text-primary)]">{props.world.worldId}</span>
          </div>
        ) : null}
        {props.world.model ? (
          <div>
            {t('Tester.worldTour.modelLabel', { defaultValue: 'model:' })}{' '}
            <span className="font-mono text-[var(--nimi-text-primary)]">{props.world.model}</span>
          </div>
        ) : null}
        {props.world.caption ? (
          <div>
            {t('Tester.worldTour.captionLabel', { defaultValue: 'caption:' })}{' '}
            <span className="text-[var(--nimi-text-primary)]">{props.world.caption}</span>
          </div>
        ) : null}
        {semantics ? (
          <div>
            {t('Tester.worldTour.semanticsLabel', { defaultValue: 'semantics:' })}{' '}
            <span className="font-mono text-[var(--nimi-text-primary)]">
              offset={Number.isFinite(semantics.groundPlaneOffset) ? semantics.groundPlaneOffset : 0}
              {' · '}
              scale={Number.isFinite(semantics.metricScaleFactor) ? semantics.metricScaleFactor : 0}
            </span>
          </div>
        ) : null}
        {props.renderPlan ? (
          <div>
            {t('Tester.worldTour.renderPlanLabel', { defaultValue: 'render plan:' })}{' '}
            <span className="font-mono text-[var(--nimi-text-primary)]">
              {props.renderPlan.mode}
              {' · '}
              camera={props.renderPlan.initialCameraPolicy.source}
              {' · '}
              spz={props.renderPlan.capabilityRequirements.requiresSpzAsset ? 'required' : 'optional'}
            </span>
          </div>
        ) : null}
        {props.sessionState ? (
          <div>
            {t('Tester.worldTour.sessionLabel', { defaultValue: 'session:' })}{' '}
            <span className="font-mono text-[var(--nimi-text-primary)]">
              {props.sessionState.sessionId}
              {' · '}
              {props.sessionState.lifecycle}
            </span>
          </div>
        ) : null}
      </Surface>

      <Surface tone="card" padding="sm" className="flex flex-col gap-1 text-xs text-[var(--nimi-text-secondary)]">
        <div className="font-semibold text-[var(--nimi-text-primary)]">
          {t('Tester.worldTour.viewerLaunchContract', { defaultValue: 'Viewer launch contract' })}
        </div>
        {props.fixture?.manifestPath ? (
          <div>
            {t('Tester.worldTour.manifestPathLabel', { defaultValue: 'manifest path:' })}{' '}
            <span className="font-mono break-all text-[var(--nimi-text-primary)]">{props.fixture.manifestPath}</span>
          </div>
        ) : null}
        {props.fixture?.spzLocalPath ? (
          <div>
            {t('Tester.worldTour.spzLocalPathLabel', { defaultValue: 'SPZ local path:' })}{' '}
            <span className="font-mono break-all text-[var(--nimi-text-primary)]">{props.fixture.spzLocalPath}</span>
          </div>
        ) : null}
        {props.fixture?.colliderMeshLocalPath ? (
          <div>
            {t('Tester.worldTour.colliderLocalPathLabel', { defaultValue: 'Collider local path:' })}{' '}
            <span className="font-mono break-all text-[var(--nimi-text-primary)]">{props.fixture.colliderMeshLocalPath}</span>
          </div>
        ) : null}
        {props.fixture ? (
          <div>
            {t('Tester.worldTour.assetDeliveryNotice', {
              defaultValue: 'asset delivery: canonical local paths resolved by Tauri, loaded directly through asset protocol',
            })}
          </div>
        ) : (
          <div>
            {t('Tester.worldTour.fixtureRequiredNotice', {
              defaultValue: 'Launch requires a resolved fixture manifest.',
            })}
          </div>
        )}
      </Surface>

      <Surface tone="card" padding="sm" className="flex flex-col gap-1 text-xs text-[var(--nimi-text-secondary)]">
        <div className="font-semibold text-[var(--nimi-text-primary)]">
          {t('Tester.worldTour.assetEndpoints', { defaultValue: 'Asset endpoints' })}
        </div>
        {Object.entries(props.world.spzUrls || {}).map(([key, url]) => (
          <div key={key} className="break-all">
            <span className="font-mono text-[var(--nimi-text-primary)]">{key}</span>: {url}
          </div>
        ))}
        {props.world.worldMarbleUrl ? (
          <div className="break-all">
            {t('Tester.worldTour.viewerHandoffLabel', { defaultValue: 'viewer handoff:' })} {props.world.worldMarbleUrl}
          </div>
        ) : null}
        {props.world.colliderMeshUrl ? (
          <div className="break-all">
            {t('Tester.worldTour.colliderMeshLabel', { defaultValue: 'collider mesh:' })} {props.world.colliderMeshUrl}
          </div>
        ) : null}
      </Surface>
    </div>
  );
}
