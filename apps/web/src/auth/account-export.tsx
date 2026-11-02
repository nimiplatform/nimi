import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createWebBrowserRealm } from './browser-realm.js';
import { loadWebCurrentAccount } from './web-account-adapter.js';
import {
  accountExportMarkdown,
  accountExportSectionLabel,
  type AccountTextExport,
} from './account-export-format.js';

const copy = {
  en: {
    title: 'Account profile and chat text',
    description:
      "Download your profile, settings, relationships and the chat text you currently have access to. Media files, credentials, local AI companions, memories, and App data aren’t included, and this file can’t be used to restore Nimi.",
    interval:
      "Data is gathered section by section while the file is being built, rather than captured at a single instant. Any incomplete sections will be noted in the file.",
    json: 'Download JSON',
    markdown: 'Download readable Markdown',
    preparing: 'Reading your account data…',
    delivered:
      "We’ve sent the file to your browser for download. Make sure it’s saved to your device before relying on this copy.",
    partial: "This export is incomplete. These sections couldn’t be read in full:",
    changed: 'The signed-in account changed. Refresh the account page before exporting.',
    failed: 'Could not export account data. Please retry.',
  },
  zh: {
    title: '账号资料与聊天文本',
    description:
      "下载你的个人资料、设置、社交关系，以及当前可读取的聊天文本。导出内容不包含媒体附件、账号凭据、本机 AI 伙伴、记忆或 App 数据，也无法用于恢复 Nimi。",
    interval: "数据会在生成文件时逐项读取，并非同一时刻的完整快照；如有未能完整读取的部分，会在文件中注明。",
    json: '下载 JSON',
    markdown: '下载可读 Markdown',
    preparing: '正在读取账号数据…',
    delivered: "文件已交给浏览器下载。请先确认文件已成功保存到本地，再将其作为留存副本。",
    partial: "本次导出不完整，以下内容未能完整读取：",
    changed: '当前登录账号已改变。请刷新账号页面后再导出。',
    failed: '无法导出账号数据，请重试。',
  },
};

// @nimi-authority: rule.nimi.sdks.realm-consumer.r046
export function AccountExport({ expectedAccountId }: { expectedAccountId: string }) {
  const { i18n } = useTranslation();
  const locale = (i18n.resolvedLanguage || i18n.language || '').startsWith('zh') ? 'zh' : 'en';
  const labels = copy[locale];
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AccountTextExport | null>(null);
  const request = useRef(0);
  useEffect(() => {
    request.current += 1;
    setResult(null);
    setError(null);
    setWorking(false);
    return () => {
      request.current += 1;
    };
  }, [expectedAccountId]);

  async function download(format: 'json' | 'md') {
    if (working || !expectedAccountId) return;
    const attempt = ++request.current;
    setWorking(true);
    setError(null);
    setResult(null);
    try {
      if ((await loadWebCurrentAccount())?.id !== expectedAccountId)
        throw new Error(labels.changed);
      if (attempt !== request.current) return;
      const data = await createWebBrowserRealm().generated.exportMyAccount({
        path: {},
        body: { expectedAccountId },
      });
      if (attempt !== request.current) return;
      // A different tab can switch the shared browser cookie while the export runs.
      const current = await loadWebCurrentAccount();
      if (attempt !== request.current) return;
      if (current?.id !== expectedAccountId || data.profile.accountId !== expectedAccountId)
        throw new Error(labels.changed);
      const body =
        format === 'json'
          ? JSON.stringify(data, null, 2) + '\n'
          : accountExportMarkdown(data, locale);
      const url = URL.createObjectURL(
        new Blob([body], {
          type:
            format === 'json' ? 'application/json;charset=utf-8' : 'text/markdown;charset=utf-8',
        }),
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = `nimi-account-${data.completedAt.slice(0, 10)}.${format}`;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      setResult(data);
    } catch (reason) {
      if (attempt === request.current)
        setError(reason instanceof Error ? reason.message : labels.failed);
    } finally {
      if (attempt === request.current) setWorking(false);
    }
  }

  return (
    <section className="web-account-actions" aria-labelledby="account-export-title">
      <h2 id="account-export-title">{labels.title}</h2>
      <p>{labels.description}</p>
      <p>{labels.interval}</p>
      <button type="button" disabled={working} onClick={() => void download('json')}>
        {labels.json}
      </button>
      <button type="button" disabled={working} onClick={() => void download('md')}>
        {labels.markdown}
      </button>
      {working ? <p role="status">{labels.preparing}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {result ? (
        <div role="status">
          <p>{labels.delivered}</p>
          {result.status === 'partial' ? (
            <>
              <p>{labels.partial}</p>
              <ul>
                {result.sections
                  .filter((section) => section.status !== 'complete')
                  .map((section) => (
                    <li key={section.name}>
                      {accountExportSectionLabel(result, section.name, locale)}
                    </li>
                  ))}
              </ul>
            </>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
