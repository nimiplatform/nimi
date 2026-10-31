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
      'Download your profile, settings, relationships and the chat text you can currently access. This does not include media files, credentials, local AI companions, memories or App data, and cannot restore Nimi.',
    interval:
      'Reads happen during generation, so this is not a snapshot of one instant. Incomplete sections are listed in the file.',
    json: 'Download JSON',
    markdown: 'Download readable Markdown',
    preparing: 'Reading your account data…',
    delivered:
      'The file was handed to your browser for download. Check that it was saved before relying on it.',
    partial: 'The download is partial. These sections could not be completed:',
    changed: 'The signed-in account changed. Refresh the account page before exporting.',
    failed: 'Could not export account data. Please retry.',
  },
  zh: {
    title: '账号资料与聊天文本',
    description:
      '下载你的资料、设置、好友关系和当前可读取的聊天文本。不包含附件文件、账号凭据、本机 AI 伙伴、记忆或 App 数据，也不能用于恢复 Nimi。',
    interval: '内容在生成期间逐项读取，不是同一时刻的快照。未完成的部分会在文件中列明。',
    json: '下载 JSON',
    markdown: '下载可读 Markdown',
    preparing: '正在读取账号数据…',
    delivered: '文件已交给浏览器下载。请确认文件已保存，再将其作为留存副本。',
    partial: '这是部分导出。以下内容未能全部读取：',
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
