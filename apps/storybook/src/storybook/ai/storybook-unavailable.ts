// Typed unavailable/failure states for the Storybook AI boundary. When no usable
// AI execution surface exists (runtime not ready, no AIConfig binding, auth
// missing, or a typed runtime contract failure), Storybook returns one of these
// instead of fabricating output. Missing generation is never success.

export type StorybookAIUnavailableReason =
  | 'runtime-not-ready'
  | 'ai-binding-missing'
  | 'input-invalid'
  | 'auth-context-missing'
  | 'principal-unauthorized'
  | 'sdk-method-unavailable'
  | 'runtime-call-failed';

export type StorybookAIUnavailable = {
  ok: false;
  capability: string;
  reason: StorybookAIUnavailableReason;
  message: string;
  actionHint: string;
};

export function aiUnavailableTitle(reason: StorybookAIUnavailableReason): string {
  switch (reason) {
    case 'runtime-not-ready': return '运行时不可用';
    case 'ai-binding-missing': return '需要选择模型绑定';
    case 'input-invalid': return '请求输入无效';
    case 'auth-context-missing': return '需要登录';
    case 'principal-unauthorized': return '会话未授权';
    case 'sdk-method-unavailable': return 'SDK 方法不可用';
    case 'runtime-call-failed': return '运行时调用失败';
  }
}

function actionHintForReason(reason: StorybookAIUnavailableReason): string {
  switch (reason) {
    case 'runtime-not-ready':
      return '恢复 Nimi 运行时连接后重试。Storybook 不会绕过运行时直接调用模型提供方。';
    case 'ai-binding-missing':
      return '在 Studio 的模型设置中为该能力选择一个运行时模型绑定（本地或云端），然后重试。Storybook 不内置任何提供方/模型。';
    case 'input-invalid':
      return '补全该生成请求所需的输入后重试。';
    case 'auth-context-missing':
      return '云端路由需要已认证的 Nimi 账户。请登录，或将该能力切换为本地模型绑定后重试。';
    case 'principal-unauthorized':
      return '运行时账户会话未授权或已过期。请重新登录后重试。';
    case 'sdk-method-unavailable':
      return '需要一个已准入的 SDK 执行方法。不要使用 app 本地 REST 绕过运行时。';
    case 'runtime-call-failed':
      return '运行时返回了一个有类型的契约失败。请查看上方运行时原始错误——这是真实的运行时/契约失败，不是伪成功。';
  }
}

export function storybookAIUnavailable(capability: string, reason: StorybookAIUnavailableReason, message: string): StorybookAIUnavailable {
  return { ok: false, capability, reason, message, actionHint: actionHintForReason(reason) };
}
