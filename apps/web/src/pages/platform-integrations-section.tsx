import { useState } from 'react';
import {
  Check,
  Lock,
  PowerOff,
  RotateCcw,
  ShieldCheck,
} from 'lucide-react';
import type { LandingLocale } from '../landing/i18n/locale.js';

// @nimi-authority: rule.nimi.runtime.integration.custody
// @nimi-authority: rule.nimi.runtime.integration.standing-permission
// @nimi-authority: rule.nimi.runtime.integration.native-messaging

export type IntegrationChannelId =
  | 'weixin'
  | 'qq'
  | 'telegram'
  | 'feishu'
  | 'onebot'
  | 'mcp'
  | 'nimi-app';

type ConsumerAppId = 'zhiyu' | 'vane' | 'parentos';

interface ChannelItem {
  id: IntegrationChannelId;
  iconSrc: string;
  name: string;
  hint: string;
}

interface ConsumerAppSpec {
  id: ConsumerAppId;
  name: string;
  icon: string;
  handleCode: string;
  scopeText: string;
  revokedText: string;
}

interface IntegrationsCopy {
  stageAriaLabel: string;
  sourcesHeading: string;
  gateHeading: string;
  consumersHeading: string;
  gateTitle: string;
  gateRuntimeTag: string;
  vaultBadge: string;
  vaultDetail: string;
  passBadge: string;
  passAllRevokedBadge: string;
  passHandles: readonly string[];
  appLiveBadge: string;
  appCutBadge: string;
  appToggleToCutAria: (name: string) => string;
  appToggleToRestoreAria: (name: string) => string;
  statusAllActive: string;
  statusPartial: (revokedNames: string, activeCount: number) => string;
  statusAllRevoked: string;
  restoreAllAction: string;
  channels: readonly ChannelItem[];
  consumerApps: readonly ConsumerAppSpec[];
  guarantees: readonly { title: string; detail: string }[];
}

const SOURCE_Y = [17, 57, 97, 137, 177, 217, 257] as const;
const CONSUMER_Y = [42, 137, 232] as const;
const PASS_EXIT_Y = 204;

const INTEGRATIONS_COPY: Readonly<Record<LandingLocale, IntegrationsCopy>> = {
  zh: {
    stageAriaLabel: 'Nimi 多源汇聚与单向安全隔离闸门动图',
    sourcesHeading: '7 类外部入口 · 仅配对一次',
    gateHeading: '单向隔离闸门 · 密钥不出本机',
    consumersHeading: '获准协同的应用 · 点击可单点断权',
    gateTitle: 'Nimi 安全隔离闸门',
    gateRuntimeTag: '本机 Runtime',
    vaultBadge: '锁死在本机保险库 · 0% 暴露',
    vaultDetail: '原始 Bot Token、登录态凭证、接口密钥与媒体解密键全部拦在此处',
    passBadge: '仅放行不透明代号与你勾选的动作',
    passAllRevokedBadge: '全部应用通路已切断 · 本机封存账号仍安然无恙',
    passHandles: ['conn_wx_*', 'conn_tg_*', 'conn_mcp_*'],
    appLiveBadge: '通行中',
    appCutBadge: '已断开',
    appToggleToCutAria: (name) => `${name} 当前通行中，点击单点切断权限`,
    appToggleToRestoreAria: (name) => `${name} 已断开权限，点击恢复通行`,
    statusAllActive: '3 款应用共享通道互不冲突 · 点击任意应用可单点断权',
    statusPartial: (revokedNames, activeCount) => `已单点切断「${revokedNames}」，其余 ${activeCount} 款应用照常运行`,
    statusAllRevoked: '已切断全部应用通路，本机封存账号仍安然无恙',
    restoreAllAction: '全部恢复',
    channels: [
      { id: 'weixin', iconSrc: '/demo/integration-logos/weixin.png', name: '微信', hint: 'Nimi Home 手机扫码配对' },
      { id: 'qq', iconSrc: '/demo/integration-logos/qq-official.png', name: 'QQ 机器人', hint: '托管官方机器人凭证' },
      { id: 'telegram', iconSrc: '/demo/integration-logos/telegram.svg', name: 'Telegram', hint: '一次托管 Bot Token，多应用共享' },
      { id: 'feishu', iconSrc: '/demo/integration-logos/feishu.svg', name: '飞书', hint: '手机飞书扫码即建个人机器人' },
      { id: 'onebot', iconSrc: '/demo/integration-logos/onebot-v11.png', name: 'OneBot v11', hint: '本机回环或带鉴权受保护连接' },
      { id: 'mcp', iconSrc: '/demo/integration-logos/mcp.svg', name: 'MCP 知识与工具', hint: '统一接入外部文档与工具服务' },
      { id: 'nimi-app', iconSrc: '/logo.svg', name: 'Nimi 应用互调', hint: '桌面运行中的应用安全借力协同' },
    ],
    consumerApps: [
      {
        id: 'zhiyu',
        name: '织羽',
        icon: '/demo/zhiyu-icon.png',
        handleCode: 'conn_wx_7a3f',
        scopeText: '仅收发允许私聊的新消息',
        revokedText: '通路已切断 · 0 字节可读',
      },
      {
        id: 'vane',
        name: 'Vane',
        icon: '/demo/vane-icon.png',
        handleCode: 'conn_mcp_docs',
        scopeText: '按授权范围查阅资料与工具',
        revokedText: '通路已切断 · 0 字节可读',
      },
      {
        id: 'parentos',
        name: 'ParentOS',
        icon: '/demo/parentos-icon.png',
        handleCode: 'conn_tg_2b8d',
        scopeText: '共享通道收发日程与提醒',
        revokedText: '通路已切断 · 0 字节可读',
      },
    ],
    guarantees: [
      { title: '0 字节密钥暴露', detail: '应用代码与日志永远拿不到原始 Token' },
      { title: '本人显式点选放行', detail: '安装软件绝不自动获权，随时一键收回' },
      { title: '媒体文件独立分区', detail: '收到的图片语音各自隔离、互不串读' },
      { title: '多应用共享不冲突', detail: '同一个机器人可同时服务伙伴与多款工具' },
    ],
  },
  en: {
    stageAriaLabel: 'Nimi many-to-many zero-exposure security gate diagram',
    sourcesHeading: '7 external sources · paired once',
    gateHeading: 'One-way gate · secrets stay local',
    consumersHeading: 'Authorized apps · click any app to cut access',
    gateTitle: 'Nimi Security Gate',
    gateRuntimeTag: 'Local Runtime',
    vaultBadge: 'Locked in local vault · 0% exposed',
    vaultDetail: 'Raw Bot tokens, session credentials, auth headers & media keys stop here',
    passBadge: 'Only opaque handles & granted actions pass',
    passAllRevokedBadge: 'All app paths cut · sealed accounts stay intact',
    passHandles: ['conn_wx_*', 'conn_tg_*', 'conn_mcp_*'],
    appLiveBadge: 'Live',
    appCutBadge: 'Cut',
    appToggleToCutAria: (name) => `${name} is live. Click to cut access`,
    appToggleToRestoreAria: (name) => `${name} is cut off. Click to restore access`,
    statusAllActive: 'All 3 apps share channels cleanly · click any app to test 1-click revoke',
    statusPartial: (revokedNames, activeCount) => `Cut off ${revokedNames} · ${activeCount} sibling ${activeCount === 1 ? 'app' : 'apps'} unaffected`,
    statusAllRevoked: 'All app paths cut · local sealed accounts stay untouched',
    restoreAllAction: 'Restore all',
    channels: [
      { id: 'weixin', iconSrc: '/demo/integration-logos/weixin.png', name: 'WeChat', hint: 'Scan official QR inside Nimi Home' },
      { id: 'qq', iconSrc: '/demo/integration-logos/qq-official.png', name: 'QQ Bot', hint: 'Seal official bot credentials once' },
      { id: 'telegram', iconSrc: '/demo/integration-logos/telegram.svg', name: 'Telegram', hint: 'Add Bot token once, share cleanly' },
      { id: 'feishu', iconSrc: '/demo/integration-logos/feishu.svg', name: 'Feishu', hint: 'One-scan personal bot setup' },
      { id: 'onebot', iconSrc: '/demo/integration-logos/onebot-v11.png', name: 'OneBot v11', hint: 'Local loopback or authenticated socket' },
      { id: 'mcp', iconSrc: '/demo/integration-logos/mcp.svg', name: 'MCP Tools', hint: 'Connect external docs & tool servers' },
      { id: 'nimi-app', iconSrc: '/logo.svg', name: 'Nimi Apps', hint: 'Running Nimi apps lend skills safely' },
    ],
    consumerApps: [
      {
        id: 'zhiyu',
        name: 'Zhiyu',
        icon: '/demo/zhiyu-icon.png',
        handleCode: 'conn_wx_7a3f',
        scopeText: 'New messages in permitted DMs only',
        revokedText: 'Path cut · 0 bytes readable',
      },
      {
        id: 'vane',
        name: 'Vane',
        icon: '/demo/vane-icon.png',
        handleCode: 'conn_mcp_docs',
        scopeText: 'Scoped external docs & tool calls',
        revokedText: 'Path cut · 0 bytes readable',
      },
      {
        id: 'parentos',
        name: 'ParentOS',
        icon: '/demo/parentos-icon.png',
        handleCode: 'conn_tg_2b8d',
        scopeText: 'Shared bot channel for family alerts',
        revokedText: 'Path cut · 0 bytes readable',
      },
    ],
    guarantees: [
      { title: 'Zero raw token exposure', detail: 'Apps and logs never touch your real keys' },
      { title: 'Explicit user consent', detail: 'No silent self-approval; revoke in one click' },
      { title: 'Isolated media folders', detail: 'Photos and voice notes never bleed across apps' },
      { title: 'Conflict-free sharing', detail: 'One bot cleanly serves multiple apps at once' },
    ],
  },
};

export function PlatformIntegrationsSection({
  locale,
}: {
  locale: LandingLocale;
}) {
  const ui = INTEGRATIONS_COPY[locale];
  const [hoveredChannel, setHoveredChannel] = useState<IntegrationChannelId | null>(null);
  const [revokedApps, setRevokedApps] = useState<Readonly<Record<ConsumerAppId, boolean>>>({
    zhiyu: false,
    vane: false,
    parentos: false,
  });

  const revokedList = ui.consumerApps.filter((app) => revokedApps[app.id]);
  const activeCount = ui.consumerApps.length - revokedList.length;
  const allRevoked = activeCount === 0;

  const statusText = allRevoked
    ? ui.statusAllRevoked
    : revokedList.length > 0
      ? ui.statusPartial(revokedList.map((app) => app.name).join(locale === 'zh' ? '、' : ', '), activeCount)
      : ui.statusAllActive;

  function toggleApp(id: ConsumerAppId) {
    setRevokedApps((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  function restoreAll() {
    setRevokedApps({ zhiyu: false, vane: false, parentos: false });
  }

  return (
    <div className="platform-integration-broker-stage" role="region" aria-label={ui.stageAriaLabel}>
      {/* Compact 3-Column Stage Header */}
      <div className="platform-shield-stage-bar">
        <span className="platform-shield-col-head">{ui.sourcesHeading}</span>
        <span className="platform-shield-col-head is-center">{ui.gateHeading}</span>
        <span className="platform-shield-col-head is-right">{ui.consumersHeading}</span>
      </div>

      {/* 5-Track Panoramic Flow: 7 Sources -> Fan-In SVG -> Gate Core -> Fan-Out SVG -> 3 Toggleable Apps */}
      <div className={`platform-shield-flow${allRevoked ? ' is-all-revoked' : ''}`}>
        {/* Track 1: All 7 External Sources */}
        <div className="platform-shield-sources">
          {ui.channels.map((ch) => {
            const isHovered = hoveredChannel === ch.id;
            return (
              <div
                key={ch.id}
                data-integration={ch.id}
                tabIndex={0}
                title={ch.hint}
                aria-label={`${ch.name} — ${ch.hint}`}
                className={`platform-shield-source-item${isHovered ? ' is-highlighted' : ''}`}
                onMouseEnter={() => setHoveredChannel(ch.id)}
                onMouseLeave={() => setHoveredChannel((prev) => (prev === ch.id ? null : prev))}
                onFocus={() => setHoveredChannel(ch.id)}
                onBlur={() => setHoveredChannel((prev) => (prev === ch.id ? null : prev))}
              >
                <img src={ch.iconSrc} alt="" width={18} height={18} loading="lazy" />
                <span>{ch.name}</span>
              </div>
            );
          })}
        </div>

        {/* Track 2: 7-to-1 Fan-In SVG */}
        <svg
          className="platform-shield-svg platform-shield-fan-in"
          viewBox="0 0 72 274"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <defs>
            <linearGradient id="shieldInGrad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#94a3b8" />
              <stop offset="100%" stopColor="#11bce2" />
            </linearGradient>
          </defs>
          {ui.channels.map((ch, idx) => {
            const y = SOURCE_Y[idx]!;
            const d = `M 0 ${y} C 36 ${y}, 38 137, 72 137`;
            const isHighlighted = hoveredChannel === ch.id;
            return (
              <g key={ch.id}>
                <path
                  d={d}
                  className={`platform-shield-in-track${isHighlighted ? ' is-highlighted' : ''}`}
                />
                <path
                  d={d}
                  pathLength={100}
                  className={`platform-shield-in-pulse${isHighlighted ? ' is-highlighted' : ''}`}
                  stroke="url(#shieldInGrad)"
                  style={{ animationDelay: `${(idx * 0.42).toFixed(2)}s` }}
                />
              </g>
            );
          })}
          <circle cx="70" cy="137" r="4.5" className="platform-shield-port-in" />
        </svg>

        {/* Track 3: Center Security Gate Chamber */}
        <div className="platform-shield-gate">
          <div className="platform-shield-gate-head">
            <span className="platform-shield-hub-pill">
              <ShieldCheck size={13} aria-hidden="true" />
              <span>{ui.gateTitle}</span>
            </span>
            <span className="platform-shield-gate-tag">{ui.gateRuntimeTag}</span>
          </div>

          <div className="platform-shield-gate-lanes">
            {/* Upper Lane: Local Vault Wall (0% exposed) */}
            <div className="platform-shield-lane is-vault">
              <div className="platform-shield-lane-top">
                <span className="platform-shield-callout-tag is-danger">
                  <Lock size={11} aria-hidden="true" />
                  {ui.vaultBadge}
                </span>
                <svg
                  className="platform-shield-mini-barrier"
                  viewBox="0 0 64 16"
                  aria-hidden="true"
                >
                  <line x1="2" y1="8" x2="54" y2="8" className="platform-shield-path-secret" />
                  <line x1="2" y1="8" x2="54" y2="8" pathLength={100} className="platform-shield-pulse-secret" />
                  <line x1="59" y1="2" x2="59" y2="14" className="platform-shield-wall-bar" />
                </svg>
              </div>
              <p>{ui.vaultDetail}</p>
            </div>

            {/* Lower Lane: Scoped Opaque Handles Pass-Through */}
            <div className={`platform-shield-lane is-pass${allRevoked ? ' is-cut' : ''}`}>
              <div className="platform-shield-lane-top">
                <span className={`platform-shield-callout-tag ${allRevoked ? 'is-muted' : 'is-safe'}`}>
                  {allRevoked ? <PowerOff size={11} aria-hidden="true" /> : <Check size={11} aria-hidden="true" />}
                  {allRevoked ? ui.passAllRevokedBadge : ui.passBadge}
                </span>
              </div>
              <div className="platform-shield-handle-row">
                {ui.passHandles.map((code) => (
                  <code key={code}>{code}</code>
                ))}
                <span className={`platform-shield-out-wire${allRevoked ? ' is-cut' : ''}`} aria-hidden="true">
                  <i />
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Track 4: 1-to-3 Fan-Out SVG (Per-App Live / Cut) */}
        <svg
          className="platform-shield-svg platform-shield-fan-out"
          viewBox="0 0 78 274"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <defs>
            <linearGradient id="shieldAllowGrad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#05dc78" />
              <stop offset="55%" stopColor="#11bce2" />
              <stop offset="100%" stopColor="#1476d4" />
            </linearGradient>
          </defs>
          <circle
            cx="2"
            cy={PASS_EXIT_Y}
            r="4.5"
            className={allRevoked ? 'platform-shield-port-cut' : 'platform-shield-port-out'}
          />
          {ui.consumerApps.map((app, idx) => {
            const y = CONSUMER_Y[idx]!;
            const isCut = revokedApps[app.id];
            const d = `M 0 ${PASS_EXIT_Y} C 36 ${PASS_EXIT_Y}, 40 ${y}, 78 ${y}`;
            const midY = Math.round((PASS_EXIT_Y + y) / 2);
            return (
              <g key={app.id}>
                <path
                  d={d}
                  className={isCut ? 'platform-shield-path-cut' : 'platform-shield-path-safe'}
                />
                {!isCut && (
                  <path
                    d={d}
                    pathLength={100}
                    className="platform-shield-pulse-safe"
                    stroke="url(#shieldAllowGrad)"
                    style={{ animationDelay: `${(idx * 0.6).toFixed(2)}s` }}
                  />
                )}
                {isCut ? (
                  <line
                    x1="44"
                    y1={midY - 8}
                    x2="44"
                    y2={midY + 8}
                    className="platform-shield-revoke-bar"
                  />
                ) : (
                  <circle cx="75" cy={y} r="3.5" className="platform-shield-port-out" />
                )}
              </g>
            );
          })}
        </svg>

        {/* Track 5: 3 Independently Toggleable Consumer Apps */}
        <div className="platform-shield-consumers">
          {ui.consumerApps.map((app) => {
            const isCut = revokedApps[app.id];
            return (
              <button
                key={app.id}
                type="button"
                data-consumer-app={app.id}
                className={`platform-shield-app-card${isCut ? ' is-revoked' : ''}`}
                aria-pressed={isCut}
                aria-label={isCut ? ui.appToggleToRestoreAria(app.name) : ui.appToggleToCutAria(app.name)}
                onClick={() => toggleApp(app.id)}
              >
                <div className="platform-shield-app-card-head">
                  <span className="platform-shield-app-identity">
                    <img src={app.icon} alt="" width={22} height={22} loading="lazy" />
                    <strong>{app.name}</strong>
                  </span>
                  <span className={`platform-shield-app-status${isCut ? ' is-cut' : ' is-live'}`}>
                    {isCut ? <PowerOff size={11} aria-hidden="true" /> : <Check size={11} aria-hidden="true" />}
                    <span>{isCut ? ui.appCutBadge : ui.appLiveBadge}</span>
                  </span>
                </div>
                <div className="platform-shield-app-card-meta">
                  <span>{isCut ? app.revokedText : app.scopeText}</span>
                  {!isCut && <code>{app.handleCode}</code>}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Live Feedback Strip for Per-App Revoke */}
      <div className="platform-shield-status-strip" aria-live="polite">
        <span className={`platform-shield-status-dot${allRevoked ? ' is-cut' : revokedList.length > 0 ? ' is-partial' : ''}`} aria-hidden="true" />
        <p>{statusText}</p>
        {revokedList.length > 0 && (
          <button
            type="button"
            className="platform-shield-restore-all-btn"
            onClick={restoreAll}
          >
            <RotateCcw size={12} aria-hidden="true" />
            <span>{ui.restoreAllAction}</span>
          </button>
        )}
      </div>

      {/* Quiet 4-Item Inline Typographic Strip */}
      <div className="platform-shield-guarantees">
        {ui.guarantees.map((item) => (
          <div key={item.title} className="platform-shield-guarantee-item">
            <strong>{item.title}</strong>
            <span>{item.detail}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
