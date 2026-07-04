import { Button, StatusBadge, Surface } from '@nimiplatform/kit/ui';
import { SlidersHorizontal, Sparkles } from 'lucide-react';

type AgentCenterCapabilitySetupSectionProps = {
  readonly hasCurrentPartner: boolean;
  readonly onConfigureModel: () => void;
  readonly onSelectPartner: () => void;
};

export function AgentCenterCapabilitySetupSection({
  hasCurrentPartner,
  onConfigureModel,
  onSelectPartner,
}: AgentCenterCapabilitySetupSectionProps) {
  const action = hasCurrentPartner ? 'configure-model' : 'select-partner';
  return (
    <Surface
      as="section"
      className="zhiyu-agent-center__capability-studio zhiyu-agent-center__capability-setup"
      data-zhiyu-region="capability-studio"
      data-zhiyu-capability-studio="setup"
      data-zhiyu-capability-studio-disabled="true"
      material="glass-thin"
      elevation="base"
      padding="md"
    >
      <div className="zhiyu-agent-center__section-heading">
        <Sparkles size={18} aria-hidden="true" />
        <div>
          <h2>文字能力</h2>
          <p>{hasCurrentPartner ? '配置模型后，文字能力会在这里开放。' : '选择本地伙伴后，再配置模型使用文字能力。'}</p>
        </div>
      </div>
      <div className="zhiyu-agent-center__setup-card">
        <StatusBadge tone="warning" shape="dot">
          {hasCurrentPartner ? '需要模型' : '需要伙伴'}
        </StatusBadge>
        <strong>{hasCurrentPartner ? '需要先配置模型' : '选择已存在伙伴'}</strong>
        <p>{hasCurrentPartner ? '当前伙伴已经选定；选择文字模型后即可生成文本、连续回复和嵌入摘要。' : '当前还没有可打开的本地伙伴；请从 Desktop Explore 的角色/人格语境确认来源后返回。'}</p>
        <Button
          type="button"
          tone="primary"
          size="sm"
          data-zhiyu-capability-setup-action={action}
          leadingIcon={hasCurrentPartner ? <SlidersHorizontal size={15} aria-hidden="true" /> : <Sparkles size={15} aria-hidden="true" />}
          onClick={hasCurrentPartner ? onConfigureModel : onSelectPartner}
        >
          {hasCurrentPartner ? '配置模型' : '查看伙伴入口'}
        </Button>
      </div>
    </Surface>
  );
}
