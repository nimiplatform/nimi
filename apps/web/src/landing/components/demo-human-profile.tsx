import { Languages, MapPin } from 'lucide-react';
import type { HeroDemoAgent } from '../content/landing-content.js';

export function DemoHumanAvatar({ person, className = '' }: { person: HeroDemoAgent; className?: string }) {
  return (
    <span className={`demo-chat-human-avatar ${className}`}>
      {person.avatarUrl ? <img src={person.avatarUrl} alt="" /> : person.initial}
    </span>
  );
}

/** Same admitted profile fields as Home's contextual human profile card. */
export function DemoHumanProfileDetails({ person, locale }: { person: HeroDemoAgent; locale: 'zh' | 'en' }) {
  const regions = new Intl.DisplayNames([locale], { type: 'region' });
  const languages = new Intl.DisplayNames([locale], { type: 'language' });
  const location = [...new Set([person.city, person.countryCode ? regions.of(person.countryCode) : null].filter(Boolean))].join(' · ');
  return (
    <div className="demo-human-profile-details">
      {person.tags?.length ? <p className="demo-human-tags">{person.tags.join(' · ')}</p> : null}
      {location && (
        <p>
          <MapPin size={14} aria-hidden="true" />
          <span>{location}</span>
        </p>
      )}
      {person.languages?.length ? (
        <p>
          <Languages size={14} aria-hidden="true" />
          <span>{person.languages.map((code) => languages.of(code)).join(' · ')}</span>
        </p>
      ) : null}
    </div>
  );
}
