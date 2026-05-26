# Revenue Contract — FG-REV-*

> Revenue dashboard, earnings breakdown, Stripe Connect, and withdrawal management.

## FG-REV-001: Overview

Revenue module consolidates creator earnings data from the existing Economy API into a creator-focused dashboard. No new backend required.

## FG-REV-002: Revenue Dashboard (`/revenue`)

### KPI Cards

Top-level metrics displayed as summary cards:

| Card | Data Source | Description |
|------|-----------|-------------|
| Spark Balance | `GET /api/economy/balances` | Current Spark balance |
| Gem Balance | `GET /api/economy/balances` | Current Gem balance |
| Total Earnings (30d) | Computed from `GET /api/economy/spark/history` | Sum of incoming Spark in last 30 days |
| Pending Withdrawal | `GET /api/economy/withdrawals/can-withdraw` | Withdrawable amount |

### Time Series Chart

SVG-rendered line chart showing earnings over time:

- Data: `GET /api/economy/spark/history` (paginated, date-sorted)
- Time ranges: 7d, 30d, 90d, 1y, all
- Two series: Spark earned (gifts received), Gem earned (subscriptions)
- Hover tooltip with exact values + date
- Rendered as inline SVG path elements (no chart library dependency)

### Earnings Breakdown

Table view of recent transactions:

- Source: `GET /api/economy/spark/history` + `GET /api/economy/gem/history`
- Columns: date, type (gift/subscription/revenue-share), amount, from (user/agent), world
- Pagination with configurable page size
- Filter by: type, date range, world, agent, release channel (when transaction metadata includes it)

## FG-REV-003: Agent/World Revenue Split

Shows revenue share configuration and per-agent earnings origin.

### Revenue Share Config

- Data: `GET /api/economy/revenue-share/config`
- Display: current split percentages (creator %, platform %, agent-origin %)
- Read-only in Forge (config managed by platform admin)

### Per-Agent Origin

- Data: `GET /api/economy/revenue-share/agent-origin/:agentId`
- Shows how much revenue each agent has generated
- Sortable agent list with earnings metrics

### Revenue Preview

- Data: `GET /api/economy/revenue-share/preview`
- Shows projected revenue based on current config before withdrawal
- Breakdown: gross → platform fee → creator net

## FG-REV-004: Stripe Connect Integration

Stripe Connect onboarding and dashboard access for creators.

### Connect Status

- Data: `GET /api/economy/connect/status`
- States: `not_connected` | `onboarding` | `connected` | `restricted`
- Display: status badge + action button

### Onboarding Flow

```
Check status → If not_connected:
  POST /api/economy/connect/onboarding → Redirect to Stripe onboarding URL
  → Stripe callback → Status updated to connected
```

### Dashboard Access

- `POST /api/economy/connect/dashboard` → Returns Stripe dashboard URL
- Opens in external browser (not in Tauri webview)

### UI

- Connect status card with clear call-to-action
- "Set up payouts" button for unconnected creators
- "Open Stripe dashboard" button for connected creators
- Status indicators: verified, pending, action required

## FG-REV-005: Withdrawal Management (`/revenue/withdrawals`)

### Withdrawal Flow

```
Check eligibility → Calculate amount → Create withdrawal → Track status
```

| Step | API |
|------|-----|
| Check config | `GET /api/economy/withdrawals/config` |
| Check eligibility | `GET /api/economy/withdrawals/can-withdraw` |
| Calculate | `GET /api/economy/withdrawals/calculate` |
| Create | `POST /api/economy/withdrawals/create` |
| History | `GET /api/economy/withdrawals/history` |
| Detail | `GET /api/economy/withdrawals/by-id/:id` |

### UI

- Withdrawal calculator: input amount → show fees → net payout preview
- "Withdraw" button (disabled if ineligible, with reason display)
- Withdrawal history table: date, amount, status, payout ID
- Status tracking: pending → processing → completed / failed

### Constraints

- Minimum withdrawal amount enforced by `withdrawals/config`
- Stripe Connect must be `connected` status
- Withdrawal cooldown period (if configured)

## FG-REV-006: Backend API Dependencies (All Existing)

| API Group | Endpoint | Method |
|-----------|----------|--------|
| Balances | `/api/economy/balances` | GET |
| Spark History | `/api/economy/spark/history` | GET |
| Gem History | `/api/economy/gem/history` | GET |
| Revenue Share Config | `/api/economy/revenue-share/config` | GET |
| Revenue Share Origin | `/api/economy/revenue-share/agent-origin/:agentId` | GET |
| Revenue Share Preview | `/api/economy/revenue-share/preview` | GET |
| Withdrawals Config | `/api/economy/withdrawals/config` | GET |
| Withdrawals Eligibility | `/api/economy/withdrawals/can-withdraw` | GET |
| Withdrawals Calculate | `/api/economy/withdrawals/calculate` | GET |
| Withdrawals Create | `/api/economy/withdrawals/create` | POST |
| Withdrawals History | `/api/economy/withdrawals/history` | GET |
| Withdrawals Detail | `/api/economy/withdrawals/by-id/:id` | GET |
| Connect Status | `/api/economy/connect/status` | GET |
| Connect Onboarding | `/api/economy/connect/onboarding` | POST |
| Connect Dashboard | `/api/economy/connect/dashboard` | POST |

## FG-REV-007: Acceptance Criteria

1. Revenue dashboard displays KPI cards with correct current balances
2. Time series chart renders Spark/Gem earnings with selectable time ranges
3. Earnings breakdown table shows transactions with type/source/amount
4. Revenue share config displays current split percentages
5. Per-agent earnings breakdown shows correct attribution
6. Stripe Connect onboarding flow works (not_connected → onboarding → connected)
7. Withdrawal calculator shows correct fees and net payout
8. Withdrawal creation blocked when ineligible with clear reason
9. Withdrawal history tracks status progression
