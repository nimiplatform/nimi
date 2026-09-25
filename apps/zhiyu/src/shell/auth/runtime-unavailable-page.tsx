import { useEffect, useState } from 'react';
import { Check, ChevronDown, Copy } from 'lucide-react';
import { Button } from '@nimiplatform/kit/ui';
import zhiyuLogoImage from '../assets/logo.png';
import type { RuntimePlatformUnavailableProjection } from './runtime-platform';
import { zhiyuRuntimeUnavailableKind, type ZhiyuRuntimeUnavailableKind } from './runtime-unavailable-kind';

type RuntimeUnavailablePageProps = {
  readonly projection?: RuntimePlatformUnavailableProjection;
  readonly message?: string;
  readonly retrying: boolean;
  readonly onRetry: () => void;
};

type RuntimeUnavailableCopy = {
  readonly title: string;
  readonly body: string;
  readonly action: string;
  readonly pending: string;
};

const RUNTIME_UNAVAILABLE_COPY: Record<ZhiyuRuntimeUnavailableKind, RuntimeUnavailableCopy> = {
  connection: {
    title: '暂时连接不上 Nimi',
    body: '请确认 Nimi 已打开，连接后会自动继续。',
    action: '重新连接',
    pending: '正在连接…',
  },
  session: {
    title: '织羽暂时无法打开',
    body: '请从 Nimi 重新打开织羽。',
    action: '重试',
    pending: '正在重试…',
  },
};

export function RuntimeConnectingScreen() {
  return (
    <main className="runtime-check-screen" aria-busy="true">
      <div className="runtime-gate-content" role="status">
        <RuntimeGateMark state="connecting" />
        <p>正在连接 Nimi…</p>
      </div>
    </main>
  );
}

export function RuntimeUnavailablePage({
  projection,
  message,
  retrying,
  onRetry,
}: RuntimeUnavailablePageProps) {
  const kind = zhiyuRuntimeUnavailableKind(projection);
  const copy = RUNTIME_UNAVAILABLE_COPY[kind];
  const reasonCode = projection?.reasonCode ?? 'runtime-unavailable';
  const actionHint = projection ? projection.actionHint : 'start_external_runtime_daemon';
  const detail = message || projection?.message || '本地服务会话尚未就绪。';
  return (
    <main
      className="runtime-unavailable-screen"
      data-zhiyu-runtime-unavailable-kind={kind}
      data-zhiyu-runtime-unavailable-reason={reasonCode}
      data-zhiyu-runtime-unavailable-action={actionHint}
    >
      <div className="runtime-gate-content" aria-live="polite">
        <RuntimeGateMark state={retrying ? 'connecting' : 'blocked'} />
        <h1>{copy.title}</h1>
        <p>{copy.body}</p>
        <Button tone="primary" loading={retrying} onClick={onRetry}>
          {retrying ? copy.pending : copy.action}
        </Button>
      </div>
      <RuntimeDiagnosticDetails reasonCode={reasonCode} actionHint={actionHint} detail={detail} />
    </main>
  );
}

function RuntimeGateMark({ state }: { readonly state: 'connecting' | 'blocked' }) {
  return (
    <div className="runtime-gate-mark" data-state={state} aria-hidden="true">
      <img src={zhiyuLogoImage} alt="" />
      <span className="runtime-gate-mark__status" />
    </div>
  );
}

type DiagnosticCopyState = 'idle' | 'copied' | 'failed';

function RuntimeDiagnosticDetails({
  reasonCode,
  actionHint,
  detail,
}: {
  readonly reasonCode: string;
  readonly actionHint?: string;
  readonly detail: string;
}) {
  const [copyState, setCopyState] = useState<DiagnosticCopyState>('idle');

  useEffect(() => {
    if (copyState === 'idle') return undefined;
    const timer = window.setTimeout(() => setCopyState('idle'), 2000);
    return () => window.clearTimeout(timer);
  }, [copyState]);

  const copyReport = () => {
    const report = [
      `reason: ${reasonCode}`,
      ...(actionHint ? [`action: ${actionHint}`] : []),
      `detail: ${detail}`,
    ].join('\n');
    void Promise.resolve()
      .then(() => navigator.clipboard.writeText(report))
      .then(() => setCopyState('copied'), () => setCopyState('failed'));
  };

  return (
    <details className="runtime-gate-details">
      <summary>
        技术详情
        <ChevronDown aria-hidden="true" size={14} />
      </summary>
      <div className="runtime-gate-details__panel">
        <dl>
          <div>
            <dt>原因</dt>
            <dd>{reasonCode}</dd>
          </div>
          {actionHint ? (
            <div>
              <dt>建议操作</dt>
              <dd>{actionHint}</dd>
            </div>
          ) : null}
          <div>
            <dt>详细信息</dt>
            <dd>{detail}</dd>
          </div>
        </dl>
        <Button
          tone="ghost"
          size="sm"
          leadingIcon={copyState === 'copied' ? <Check aria-hidden="true" size={14} /> : <Copy aria-hidden="true" size={14} />}
          onClick={copyReport}
        >
          {copyState === 'copied' ? '已复制' : copyState === 'failed' ? '复制失败' : '复制'}
        </Button>
      </div>
    </details>
  );
}
