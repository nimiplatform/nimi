## Mods

| source | current surface | trigger | user initiated? | message key / literal | current behavior | target channel | keep? | reason |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `slot-host.tsx` render failed | global banner | passive_state | no | `ModUI.renderFailedWithChain` | 被动渲染故障弹全局 | `page_inline` (`Mods`) | migrated | 现在只保留 fuse/telemetry，由 Mods 上下文承载 |

## Settings / Auth

| source | current surface | trigger | user initiated? | message key / literal | current behavior | target channel | keep? | reason |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `web-auth-menu.tsx` auth warning/error incl. onboarding pending | global banner | user_action | yes | `AUTH_COPY.onboardingPending`, auth errors | 登录页 warning/error 冒到全局 | `page_inline` | migrated | 现在落到 auth page footer inline，不再打全局 |

## Contacts / Profile / Notification / Chat / Data Management

| source | current surface | trigger | user initiated? | message key / literal | current behavior | target channel | keep? | reason |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `turn-input.tsx` upload/send/read-only/unsupported-file | global banner | user_action | yes | `TurnInput.*` | composer 错误弹全局 | `page_inline` / composer inline | migrated | 输入框上方 inline 更合适 |

## Remaining Whitelist
