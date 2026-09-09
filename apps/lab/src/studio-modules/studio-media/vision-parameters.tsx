import { SelectField } from '@nimiplatform/kit/ui';
import { defineStudioParameters, LOCAL_ONLY_STUDIO_PARAMETER } from '../../ai-studio-core/parameters.js';
import { StudioParameterField, type StudioParameterPanelProps } from '../../ai-studio-core/parameter-fields.js';
import { useTranslation } from '../../shell/i18n/index.js';

export const studioVisionLocateParameters = defineStudioParameters<{ geometry: 'box' | 'point' }>({
  initial: () => ({ geometry: 'box' }), routeMatrix: { geometry: LOCAL_ONLY_STUDIO_PARAMETER },
});

export function StudioVisionParameterPanel(props: StudioParameterPanelProps) {
  const { t } = useTranslation();
  return <div className="studio-parameters">
    <StudioParameterField label={t('VisionLocate.geometry')}>
      <SelectField value={props.parameters.geometry === 'point' ? 'point' : 'box'} disabled={props.disabled || props.source === 'cloud'} onChange={event => props.onChange({ geometry: event.currentTarget.value })} options={[{value:'box',label:t('VisionLocate.box')},{value:'point',label:t('VisionLocate.point')}]} />
    </StudioParameterField>
    <p>{t('VisionLocate.localOnly')}</p>
  </div>;
}
