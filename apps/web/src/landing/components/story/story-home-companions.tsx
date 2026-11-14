import { ArrowUp, BatteryFull, LockKeyhole, Plus, Send, Signal, Wifi } from 'lucide-react';
import type { HeroDemo } from '../../content/landing-content.js';
import { DEFAULT_STORY_AGENT } from '../../content/story-model.js';

export function StoryHomeCompanions({ demo }: { demo: HeroDemo }) {
  const zhiyu = demo.appPreview.zhiyu;
  const partner = zhiyu.partners.find(candidate => candidate.id === DEFAULT_STORY_AGENT)!;
  return <div className="story-home-companions" aria-hidden="true">
    <div className="story-home-phone">
      <span className="story-home-phone-key story-home-phone-action" />
      <span className="story-home-phone-key story-home-phone-volume-up" />
      <span className="story-home-phone-key story-home-phone-volume-down" />
      <span className="story-home-phone-key story-home-phone-power" />
      <span className="story-home-phone-speaker" />
      <div className="story-home-phone-screen">
        <div className="story-home-phone-status">
          <span>9:41</span>
          <span className="story-home-phone-status-icons">
            <Signal />
            <Wifi />
            <BatteryFull />
          </span>
        </div>
        <header className="story-home-phone-header">
          <img src={partner.avatarUrl ?? undefined} alt="" />
          <div><strong>{partner.name}</strong><small>Nimi</small></div>
        </header>
        <div className="story-home-phone-conversation">
          {partner.messages.map(message => <p key={message.id} className={`story-home-phone-message is-${message.role}`}>
            {message.text}
          </p>)}
        </div>
        <div className="story-home-phone-composer"><span>{demo.chat.inputPlaceholder}</span><i><ArrowUp size={11} strokeWidth={2.2} /></i></div>
        <span className="story-home-phone-home-indicator" />
      </div>
    </div>
    <div className="story-home-web">
      <span className="story-home-web-camera" />
      <div className="story-home-web-screen">
        <div className="story-home-web-bar">
          <span className="story-home-web-dots"><i /><i /><i /></span>
          <span className="story-home-web-address"><LockKeyhole size={9} />zhiyu.app · Nimi Remote</span>
          <span className="story-home-web-more"><i /><i /><i /></span>
        </div>
        <div className="story-home-web-viewport">
          <div className="story-home-web-rail">
            <img className="story-home-web-logo" src="/demo/zhiyu/logo.png" alt="" />
            {zhiyu.partners.map(candidate => <img key={candidate.id} src={candidate.avatarUrl ?? undefined} alt=""
              className={candidate.id === partner.id ? 'is-current' : undefined} />)}
          </div>
          <div className="story-home-web-chat">
            <header className="story-home-web-header"><strong>{partner.name}</strong><span>{zhiyu.appName}</span></header>
            <div className="story-home-web-conversation">
              {partner.messages.map(message => <p key={message.id} className={`story-home-web-message is-${message.role}`}>
                {message.text}
              </p>)}
            </div>
            <div className="story-home-web-composer">
              <span>{zhiyu.copy.composerPlaceholder}</span>
              <div><img src={partner.avatarUrl ?? undefined} alt="" /><Plus /><Send /></div>
            </div>
          </div>
        </div>
        <span className="story-home-web-home-indicator" />
      </div>
    </div>
  </div>;
}
