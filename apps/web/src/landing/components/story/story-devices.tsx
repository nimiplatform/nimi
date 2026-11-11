import { Cpu, Globe2, House, Laptop, Smartphone } from 'lucide-react';
import type { StoryText } from '../../content/story-copy.js';
import { StoryHeading } from './story-shared.js';

// @nimi-authority: rule.nimi.runtime.remote-access.direct-transport
// @nimi-authority: rule.nimi.runtime.remote-access.source-admission
// @nimi-authority: rule.nimi.platform.remote-clients.android-development
export function StoryDevices({ t }: { t: StoryText }) {
  return <section id="devices" className="story-section story-devices" aria-labelledby="devices-heading" data-story-scene>
    <div className="story-container">
      <StoryHeading t={t} section="devices" />
      <div className="story-devices-present">
        <div className="story-devices-copy">
          <span className="story-eyebrow">{t('devices.current')}</span>
          <h3>{t('devices.runtimeTitle')}</h3>
          <p>{t('devices.runtimeBody')}</p>
          <p>{t('devices.continuity')}</p>
          <small>{t('devices.androidNote')}</small>
        </div>
        <figure className="story-devices-map" aria-labelledby="devices-map-caption">
          <div className="story-devices-host">
            <div className="story-devices-screen">
              <span>{t('devices.host')}</span>
              <img src="/logo.svg" alt="" />
              <strong>Nimi Runtime</strong>
              <small>{t('devices.execution')}</small>
            </div>
            <div className="story-devices-stand" aria-hidden="true" />
          </div>
          <div className="story-devices-branches" aria-hidden="true"><i /><i /><i /></div>
          <ul className="story-devices-clients">
            <li><span className="story-device-icon"><Laptop size={29} aria-hidden="true" /></span><strong>{t('devices.desktop')}</strong><small>{t('devices.desktopDetail')}</small></li>
            <li><span className="story-device-icon"><Globe2 size={29} aria-hidden="true" /></span><strong>Web</strong><small>{t('devices.webDetail')}</small></li>
            <li><span className="story-device-icon"><Smartphone size={29} aria-hidden="true" /></span><strong>Android</strong><small>{t('devices.androidDetail')}</small></li>
          </ul>
          <figcaption id="devices-map-caption">{t('devices.mapCaption')}</figcaption>
        </figure>
      </div>
      <p className="story-devices-requirements">{t('devices.requirements')}</p>
      <div className="story-devices-future">
        <div>
          <span className="story-eyebrow">{t('devices.vision')}</span>
          <h3>{t('devices.visionTitle')}</h3>
          <p>{t('devices.visionBody')}</p>
        </div>
        <div className="story-devices-horizon">
          <ul>
            <li><Smartphone size={25} aria-hidden="true" /><span>{t('devices.mobile')}</span></li>
            <li><Cpu size={25} aria-hidden="true" /><span>{t('devices.embedded')}</span></li>
            <li><House size={25} aria-hidden="true" /><span>{t('devices.home')}</span></li>
          </ul>
          <small>{t('devices.futureNote')}</small>
        </div>
      </div>
    </div>
  </section>;
}
