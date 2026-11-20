import { BookOpen, Check, Lock, MessageCircle, ShieldCheck, X } from 'lucide-react';
import type { LandingLinks } from '../../config/landing-links.js';
import type { StoryText } from '../../content/story-copy.js';
import { StoryHeading, StoryLink } from './story-shared.js';

export function StoryIntegrations({ t, links }: { t: StoryText; links: LandingLinks }) {
  const isZh = t('common.language') === '语言';
  return (
    <section id="integrations" className="story-section story-integrations" aria-labelledby="integrations-heading" data-story-scene>
      <div className="story-container">
        <StoryHeading t={t} section="integrations" />
        <div className="story-integration-grid">
          <article className="story-integration-card story-integration-card--wide">
            <header className="story-integration-copy">
              <ShieldCheck size={22} aria-hidden="true" />
              <h3>{t('integrations.app')}</h3>
              <p>{t('integrations.appScope')}</p>
            </header>
            <div className="story-integration-scopes">
              <ul className="story-integration-scope-list">
                <li>
                  <span className="story-integration-app-identity">
                    <img src="/demo/zhiyu-icon.png" width={30} height={30} alt="" />
                    <span>
                      <strong>{t('experience.zhiyuApp')}</strong>
                      <small>{t('integrations.zhiyuRole')}</small>
                    </span>
                  </span>
                  <span className="story-integration-perm-badges">
                    <span className="is-allowed"><Check size={12} aria-hidden="true" />{isZh ? '长久陪伴对话' : 'Companion chat'}</span>
                    <span className="is-allowed"><Check size={12} aria-hidden="true" />{isZh ? '调用语音与生图' : 'Voice & AI'}</span>
                  </span>
                </li>
                <li>
                  <span className="story-integration-app-identity">
                    <img src="/demo/vane-icon.png" width={30} height={30} alt="" />
                    <span>
                      <strong>Vane</strong>
                      <small>{t('integrations.vaneRole')}</small>
                    </span>
                  </span>
                  <span className="story-integration-perm-badges">
                    <span className="is-allowed"><Check size={12} aria-hidden="true" />{isZh ? '调用 AI 搜索' : 'AI search'}</span>
                    <span className="is-blocked"><X size={12} aria-hidden="true" />{isZh ? '不碰伙伴私聊' : 'No private chats'}</span>
                  </span>
                </li>
                <li>
                  <span className="story-integration-app-identity">
                    <img src="/demo/parentos-icon.png" width={30} height={30} alt="" />
                    <span>
                      <strong>ParentOS</strong>
                      <small>{t('integrations.parentosRole')}</small>
                    </span>
                  </span>
                  <span className="story-integration-perm-badges">
                    <span className="is-allowed"><Check size={12} aria-hidden="true" />{isZh ? '语音转写与协助' : 'Voice & task help'}</span>
                    <span className="is-blocked"><X size={12} aria-hidden="true" />{isZh ? '家庭档案独立存放' : 'Isolated family folder'}</span>
                  </span>
                </li>
              </ul>
              <div className="story-integration-partition-bar">
                <Lock size={14} aria-hidden="true" />
                <span>{t('integrations.partitionNote')}</span>
              </div>
            </div>
          </article>
          <article className="story-integration-card">
            <header className="story-integration-copy">
              <BookOpen size={22} aria-hidden="true" />
              <h3>{t('integrations.mcp')}</h3>
              <p>{t('integrations.mcpScope')}</p>
            </header>
            <ul className="story-integration-sample story-integration-services">
              <li>
                <span className="story-integration-service-name story-integration-source-picker">
                  <span className="story-integration-microsoft" aria-hidden="true"><i /><i /><i /><i /></span>
                  <strong>Microsoft Learn</strong>
                </span>
                <span className="story-integration-connection is-connected">
                  <Check size={14} aria-hidden="true" />
                  {t('integrations.mcpBadge')}
                </span>
              </li>
              <li>
                <span className="story-integration-service-name">
                  <img src="/demo/integration-logos/mcp.svg" width={22} height={22} alt="" />
                  <strong>{isZh ? '本地文档与工具源 (MCP)' : 'Local Docs & MCP Tools'}</strong>
                </span>
                <span className="story-integration-connection">{t('integrations.connect')}</span>
              </li>
            </ul>
          </article>
          <article className="story-integration-card">
            <header className="story-integration-copy">
              <MessageCircle size={22} aria-hidden="true" />
              <h3>{t('integrations.messaging')}</h3>
              <p>{t('integrations.messagingScope')}</p>
            </header>
            <ul className="story-integration-sample story-integration-services">
              <li>
                <span className="story-integration-service-name">
                  <img src="/demo/integration-logos/weixin.png" width={28} height={28} alt="" />
                  <strong>{t('integrations.wechat')}</strong>
                </span>
                <span className="story-integration-connection is-connected"><Check size={14} aria-hidden="true" />{t('integrations.connected')}</span>
              </li>
              <li>
                <span className="story-integration-service-name">
                  <img src="/demo/integration-logos/qq-official.png" width={28} height={28} alt="" />
                  <strong>{isZh ? 'QQ 机器人' : 'QQ Bot'}</strong>
                </span>
                <span className="story-integration-connection">{t('integrations.connect')}</span>
              </li>
              <li>
                <span className="story-integration-service-name">
                  <img src="/demo/integration-logos/feishu.svg" width={28} height={28} alt="" />
                  <strong>{t('integrations.feishu')}</strong>
                </span>
                <span className="story-integration-connection">{t('integrations.connect')}</span>
              </li>
              <li>
                <span className="story-integration-service-name">
                  <img src="/demo/integration-logos/telegram.svg" width={28} height={28} alt="" />
                  <strong>{t('integrations.telegram')}</strong>
                </span>
                <span className="story-integration-connection">{t('integrations.connect')}</span>
              </li>
            </ul>
          </article>
        </div>
        <div className="story-integration-management">
          <p>{t('integrations.footnote')}</p>
          <StoryLink href={links.integrationsUrl}>{t('integrations.details')}</StoryLink>
        </div>
      </div>
    </section>
  );
}
