import { Battery, CalendarDays, Compass, Folder, Image as ImageIcon, Mail, MessageCircle, Music2, Search, Settings, Trash2, Wifi } from 'lucide-react';
import type { HeroDemo } from '../../content/landing-content.js';

export function StoryMacDesktop({ demo }: { demo: HeroDemo }) {
  const zh = demo.appPreview.locale === 'zh';
  const menus = zh ? ['文件', '编辑', '显示', '窗口', '帮助'] : ['File', 'Edit', 'View', 'Window', 'Help'];
  const dock = [
    { id: 'finder', icon: <svg viewBox="0 0 40 40"><path d="M4 5h32v30H4z" fill="#67c7f2" /><path d="M20 5h16v30H20z" fill="#2584cf" /><path d="M10 14v5m20-5v5M11 26c5 5 13 5 18 0" fill="none" stroke="#17466d" strokeWidth="2" strokeLinecap="round" /></svg> },
    { id: 'launchpad', icon: <span className="story-mac-launchpad">{Array.from({ length: 9 }, (_, index) => <i key={index} />)}</span> },
    { id: 'safari', icon: <Compass /> },
    { id: 'messages', icon: <MessageCircle /> },
    { id: 'mail', icon: <Mail /> },
    { id: 'photos', icon: <ImageIcon /> },
    { id: 'nimi', icon: <img src="/logo.svg" alt="" /> },
    { id: 'calendar', icon: <CalendarDays /> },
    { id: 'music', icon: <Music2 /> },
    { id: 'settings', icon: <Settings /> },
    { id: 'files', icon: <Folder /> },
    { id: 'trash', icon: <Trash2 /> },
  ];
  return <div className="story-home-mac-desktop" aria-hidden="true">
    <div className="story-home-mac-wallpaper" />
    <div className="story-home-mac-menu">
      <div className="story-home-mac-menu-left">
        <strong>Nimi Home</strong>
        <span className="story-home-mac-menu-actions">{menus.map(menu => <span key={menu}>{menu}</span>)}</span>
      </div>
      <div className="story-home-mac-notch" />
      <div className="story-home-mac-menu-right">
        <Battery className="story-mac-battery" preserveAspectRatio="none" />
        <Wifi />
        <Search />
        <span className="story-mac-control-center"><i /><i /></span>
        <img className="story-mac-siri" src="/story/mac-menu-siri.png" alt="" />
        <span className="story-mac-menu-date"><span>{demo.home.date}</span><time>14:20</time></span>
      </div>
    </div>
    <div className="story-home-mac-dock">
      {dock.map(item => <span key={item.id} className={`story-mac-icon is-${item.id}`}>{item.icon}</span>)}
    </div>
  </div>;
}
