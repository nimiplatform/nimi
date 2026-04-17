export type ChatAgentAvatarLive2dFramingInput = {
  railWidth: number;
  railHeight: number;
  modelCanvasWidth: number | null;
  modelCanvasHeight: number | null;
  layout: ReadonlyMap<string, number>;
};

export type ChatAgentAvatarLive2dFramingPolicy = {
  mode: 'layout' | 'full-body-tall' | 'upper-body-portrait' | 'wide-in-portrait' | 'default';
  height?: number;
  width?: number;
  centerX?: number;
  centerY?: number;
};

function hasStrongVerticalLayout(layout: ReadonlyMap<string, number>): boolean {
  return layout.has('CenterY')
    || layout.has('Y')
    || layout.has('Top')
    || layout.has('Bottom');
}

export function resolveChatAgentAvatarLive2dFramingPolicy(
  input: ChatAgentAvatarLive2dFramingInput,
): ChatAgentAvatarLive2dFramingPolicy {
  const railIsPortrait = input.railHeight > input.railWidth;
  const canvasWidth = input.modelCanvasWidth && input.modelCanvasWidth > 0 ? input.modelCanvasWidth : null;
  const canvasHeight = input.modelCanvasHeight && input.modelCanvasHeight > 0 ? input.modelCanvasHeight : null;
  const canvasAspect = canvasWidth && canvasHeight ? canvasHeight / canvasWidth : null;

  if (input.layout.size > 0) {
    if (railIsPortrait && !hasStrongVerticalLayout(input.layout)) {
      return {
        mode: 'layout',
        centerX: 0,
        centerY: 0.06,
      };
    }
    return {
      mode: 'layout',
    };
  }

  if (railIsPortrait && canvasAspect !== null) {
    if (canvasAspect >= 1.28) {
      return {
        mode: 'full-body-tall',
        height: 2.2,
        centerX: 0,
        centerY: 0.13,
      };
    }
    if (canvasAspect <= 0.92) {
      return {
        mode: 'wide-in-portrait',
        width: 2,
        centerX: 0,
        centerY: 0.03,
      };
    }
    return {
      mode: 'upper-body-portrait',
      height: 2.22,
      centerX: 0,
      centerY: 0.1,
    };
  }

  return {
    mode: 'default',
    height: 2,
    centerX: 0,
    centerY: 0,
  };
}
