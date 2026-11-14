import { ArrowRight, BookOpen, Check, ChevronDown, Layers3, MessageCircle, MoreHorizontal } from 'lucide-react';
import type { LandingLinks } from '../../config/landing-links.js';
import type { StoryText } from '../../content/story-copy.js';
import { StoryHeading, StoryLink } from './story-shared.js';

function IntegrationChecklist({ t }: { t: StoryText }) {
  return (
    <ul className="story-integration-checklist">
      <li>
        <span className="story-integration-check is-checked" aria-hidden="true"><Check size={12} strokeWidth={3} /></span>
        <span>{t('integrations.checklistFood')}</span>
      </li>
      <li>
        <span className="story-integration-check" aria-hidden="true" />
        <span>{t('integrations.checklistMeetup')}</span>
      </li>
    </ul>
  );
}

export function StoryIntegrations({ t, links }: { t: StoryText; links: LandingLinks }) {
  return (
    <section id="integrations" className="story-section story-integrations" aria-labelledby="integrations-heading" data-story-scene>
      <div className="story-container">
        <StoryHeading t={t} section="integrations" />
        <div className="story-integration-grid">
          <article className="story-integration-card story-integration-card--wide">
            <header className="story-integration-copy">
              <Layers3 size={22} aria-hidden="true" />
              <h3>{t('integrations.app')}</h3>
              <p>{t('integrations.appScope')}</p>
            </header>
            <div className="story-integration-flow">
              <div className="story-integration-sample story-integration-sample--nimigo">
                <div className="story-integration-sample-heading">
                  <img src="/story/nimigo-icon.png" width={28} height={28} alt="" />
                  <strong>NimiGo</strong>
                  <MoreHorizontal size={18} aria-hidden="true" />
                </div>
                <div className="story-integration-sample-body">
                  <span className="story-integration-skeleton story-integration-skeleton--label" aria-hidden="true" />
                  <strong className="story-integration-checklist-title">{t('integrations.checklist')}</strong>
                  <IntegrationChecklist t={t} />
                  <div className="story-integration-skeleton-group" aria-hidden="true">
                    <span className="story-integration-skeleton" />
                    <span className="story-integration-skeleton story-integration-skeleton--short" />
                  </div>
                </div>
              </div>
              <span className="story-integration-arrow" aria-hidden="true"><ArrowRight size={22} /></span>
              <div className="story-integration-sample story-integration-sample--nimiday">
                <div className="story-integration-sample-heading">
                  <img src="/story/nimiday-icon.png" width={28} height={28} alt="" />
                  <strong>NimiDay</strong>
                  <MoreHorizontal size={18} aria-hidden="true" />
                </div>
                <div className="story-integration-sample-body">
                  <strong className="story-integration-handoff-title">{t('integrations.checklist')}</strong>
                  <div className="story-integration-handoff-list"><IntegrationChecklist t={t} /></div>
                  <span className="story-integration-save">{t('integrations.save')}</span>
                </div>
              </div>
            </div>
          </article>
          <article className="story-integration-card">
            <header className="story-integration-copy">
              <BookOpen size={22} aria-hidden="true" />
              <h3>{t('integrations.mcp')}</h3>
              <p>{t('integrations.mcpScope')}</p>
            </header>
            <div className="story-integration-sample story-integration-source">
              <div className="story-integration-sample-heading story-integration-source-picker">
                <span className="story-integration-microsoft" aria-hidden="true"><i /><i /><i /><i /></span>
                <strong>Microsoft Learn</strong>
                <ChevronDown size={16} aria-hidden="true" />
              </div>
              <div className="story-integration-source-body" aria-hidden="true">
                <span className="story-integration-skeleton story-integration-skeleton--source-title" />
                <span className="story-integration-skeleton" />
                <span className="story-integration-skeleton story-integration-skeleton--short" />
              </div>
            </div>
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
                  <img src="/demo/integration-logos/weixin.png" width={30} height={30} alt="" />
                  <strong>{t('integrations.wechat')}</strong>
                </span>
                <span className="story-integration-connection is-connected"><Check size={14} aria-hidden="true" />{t('integrations.connected')}</span>
              </li>
              <li>
                <span className="story-integration-service-name">
                  <img src="/demo/integration-logos/feishu.svg" width={30} height={30} alt="" />
                  <strong>{t('integrations.feishu')}</strong>
                </span>
                <span className="story-integration-connection">{t('integrations.connect')}</span>
              </li>
              <li>
                <span className="story-integration-service-name">
                  <img src="/demo/integration-logos/telegram.svg" width={30} height={30} alt="" />
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
