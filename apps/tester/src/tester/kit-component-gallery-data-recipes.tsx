import {
  Avatar,
  Button,
  DataList,
  DataTable,
  EmptyState,
  InlineAlert,
  LoadingSkeleton,
  nimiToast,
  ProgressIndicator,
  Statistic,
  StatisticGroup,
  StatusBadge,
  Timeline,
  TimelineGroup,
} from '@nimiplatform/kit/ui';
import { Boxes, RefreshCw } from 'lucide-react';
import type { Recipe } from './kit-component-gallery-recipes.js';

export const DATA_RECIPES: Recipe[] = [
  {
    id: 'statistic',
    category: 'data',
    name: 'Statistic summary',
    exportsLabel: 'Statistic, StatisticGroup',
    importNames: ['Statistic', 'StatisticGroup'],
    badge: { label: 'metrics', tone: 'success' },
    wide: true,
    stage: (
      <StatisticGroup className="w-full">
        <Statistic label="Routes ready" value="18" suffix="/ 24" trend="up" tone="success" />
        <Statistic label="Blocked lanes" value="2" trend="down" tone="warning" />
        <Statistic label="Coverage" value="92" suffix="%" tone="brand" />
      </StatisticGroup>
    ),
    snippet: `<StatisticGroup>
  <Statistic label="Routes ready" value="18" suffix="/ 24" trend="up" tone="success" />
  <Statistic label="Blocked lanes" value="2" trend="down" tone="warning" />
  <Statistic label="Coverage" value="92" suffix="%" tone="brand" />
</StatisticGroup>`,
    props: [
      { name: 'label / value', desc: 'metric identity and value content' },
      { name: 'prefix / suffix', desc: 'optional value chrome' },
      { name: 'trend / tone', desc: 'semantic metric direction and status color' },
    ],
  },
  {
    id: 'data-list',
    category: 'data',
    name: 'DataList',
    exportsLabel: 'DataList',
    importNames: ['DataList'],
    badge: { label: 'records', tone: 'info' },
    wide: true,
    stage: (
      <DataList
        ariaLabel="Capability lane records"
        items={[
          { id: 'text', title: 'text.generate', meta: 'SDK runtime route', trailing: <StatusBadge tone="success">ready</StatusBadge> },
          { id: 'image', title: 'image.generate', meta: 'Runtime admission required', trailing: <StatusBadge tone="warning">review</StatusBadge> },
        ]}
      />
    ),
    snippet: `<DataList
  ariaLabel="Capability lane records"
  items={[
    {
      id: 'text',
      title: 'text.generate',
      meta: 'SDK runtime route',
      trailing: <StatusBadge tone="success">ready</StatusBadge>,
    },
  ]}
/>`,
    props: [
      { name: 'items', desc: 'record list with title, description, meta, leading, trailing, actions' },
      { name: 'ariaLabel', desc: 'required list label for assistive tech' },
      { name: 'empty', desc: 'consumer-owned empty state node' },
    ],
  },
  {
    id: 'data-table',
    category: 'data',
    name: 'DataTable',
    exportsLabel: 'DataTable',
    importNames: ['DataTable'],
    badge: { label: 'matrix', tone: 'info' },
    wide: true,
    stage: (
      <DataTable
        ariaLabel="Kit route matrix"
        rows={[
          { id: 'chat', capability: 'chat.stream', owner: 'runtime', status: 'ready' },
          { id: 'embed', capability: 'text.embed', owner: 'runtime', status: 'ready' },
          { id: 'commerce', capability: 'gift.send', owner: 'realm', status: 'guarded' },
        ]}
        rowKey={(row) => row.id}
        columns={[
          { key: 'capability', title: 'Capability', render: (row) => <code>{row.capability}</code> },
          { key: 'owner', title: 'Owner', render: (row) => row.owner },
          { key: 'status', title: 'Status', align: 'right', render: (row) => <StatusBadge tone={row.status === 'ready' ? 'success' : 'warning'}>{row.status}</StatusBadge> },
        ]}
      />
    ),
    snippet: `<DataTable
  ariaLabel="Kit route matrix"
  rows={[{ id: 'chat', capability: 'chat.stream', owner: 'runtime', status: 'ready' }]}
  rowKey={(row) => row.id}
  columns={[
    { key: 'capability', title: 'Capability', render: (row) => <code>{row.capability}</code> },
    { key: 'owner', title: 'Owner', render: (row) => row.owner },
    { key: 'status', title: 'Status', align: 'right', render: (row) => row.status },
  ]}
/>`,
    props: [
      { name: 'rows / columns', desc: 'typed rows and render callbacks' },
      { name: 'rowKey', desc: 'stable key resolver' },
      { name: 'empty', desc: 'table body empty row content' },
    ],
  },
  {
    id: 'status',
    category: 'data',
    name: 'StatusBadge',
    exportsLabel: 'StatusBadge',
    importNames: ['StatusBadge'],
    badge: { label: 'signals', tone: 'success' },
    stage: (
      <>
        <StatusBadge tone="success" shape="dot">ready</StatusBadge>
        <StatusBadge tone="warning" shape="dot">attention</StatusBadge>
        <StatusBadge tone="danger" shape="dot">blocked</StatusBadge>
        <StatusBadge tone="info" shape="soft">info</StatusBadge>
        <StatusBadge tone="neutral" shape="outline">neutral</StatusBadge>
      </>
    ),
    snippet: `<>
  <StatusBadge tone="success" shape="dot">ready</StatusBadge>
  <StatusBadge tone="warning" shape="dot">attention</StatusBadge>
  <StatusBadge tone="danger" shape="dot">blocked</StatusBadge>
  <StatusBadge tone="info" shape="soft">info</StatusBadge>
  <StatusBadge tone="neutral" shape="outline">neutral</StatusBadge>
</>`,
    props: [
      { name: 'tone', desc: 'neutral | success | warning | danger | info' },
      { name: 'shape', desc: 'soft | outline | dot' },
    ],
  },
  {
    id: 'alert',
    category: 'data',
    name: 'InlineAlert',
    exportsLabel: 'InlineAlert',
    importNames: ['InlineAlert'],
    badge: { label: 'signals', tone: 'warning' },
    wide: true,
    stage: (
      <div className="kit-inline-alert-recipe grid w-full min-w-0 gap-6">
        <InlineAlert tone="info">Runtime session is ready for this capability.</InlineAlert>
        <InlineAlert tone="warning">Bind a model before running this lane.</InlineAlert>
      </div>
    ),
    snippet: `<div className="kit-inline-alert-recipe grid w-full min-w-0 gap-6">
  <InlineAlert tone="info">Runtime session is ready for this capability.</InlineAlert>
  <InlineAlert tone="warning">Bind a model before running this lane.</InlineAlert>
</div>`,
    props: [
      { name: 'tone', desc: 'neutral | success | warning | danger | info' },
      { name: 'icon', desc: 'optional leading icon node' },
    ],
  },
  {
    id: 'toast',
    category: 'data',
    name: 'Toast',
    exportsLabel: 'nimiToast, NimiToaster',
    importNames: ['nimiToast', 'NimiToaster'],
    badge: { label: 'signals', tone: 'info' },
    wide: true,
    stage: (
      <div className="flex w-full min-w-0 flex-wrap items-center gap-3">
        <Button size="sm" tone="secondary" onClick={() => nimiToast.success('Export finished.')}>Success</Button>
        <Button size="sm" tone="secondary" onClick={() => nimiToast.info('Runtime check scheduled.')}>Info</Button>
        <Button size="sm" tone="secondary" onClick={() => nimiToast.warning('Local model cache is almost full.')}>Warning</Button>
        <Button size="sm" tone="secondary" onClick={() => nimiToast.danger('Bridge connection lost.')}>Danger</Button>
        <Button
          size="sm"
          tone="secondary"
          onClick={() => nimiToast.info('Update ready to install.', {
            action: { label: 'Restart', onClick: () => nimiToast.success('Restart scheduled.') },
          })}
        >
          With action
        </Button>
      </div>
    ),
    snippet: `<NimiToaster /> // mount once near the app root

<Button onClick={() => nimiToast.success('Export finished.')}>Success</Button>
<Button onClick={() => nimiToast.info('Runtime check scheduled.')}>Info</Button>
<Button onClick={() => nimiToast.warning('Local model cache is almost full.')}>Warning</Button>
<Button onClick={() => nimiToast.danger('Bridge connection lost.')}>Danger</Button>
<Button
  onClick={() =>
    nimiToast.info('Update ready to install.', {
      action: { label: 'Restart', onClick: () => nimiToast.success('Restart scheduled.') },
    })
  }
>
  With action
</Button>`,
    props: [
      { name: 'nimiToast.{tone}', desc: 'success | info | warning | danger | neutral imperative helpers' },
      { name: 'action', desc: 'optional { label, onClick } trailing action' },
      { name: 'durationMs / sticky', desc: 'auto-dismiss delay; sticky keeps the toast until dismissed' },
      { name: 'NimiToaster', desc: 'viewport host mounted once near the app root' },
    ],
  },
  {
    id: 'progress',
    category: 'data',
    name: 'Progress / Skeleton',
    exportsLabel: 'ProgressIndicator, LoadingSkeleton',
    importNames: ['ProgressIndicator', 'LoadingSkeleton'],
    badge: { label: 'loading', tone: 'info' },
    stage: (
      <div className="kit-stack" style={{ width: '100%' }}>
        <ProgressIndicator value={72} showValue />
        <LoadingSkeleton lines={3} />
      </div>
    ),
    snippet: `<div className="kit-stack" style={{ width: '100%' }}>
  <ProgressIndicator value={72} showValue />
  <LoadingSkeleton lines={3} />
</div>`,
    props: [
      { name: 'value', desc: '0-100 progress percentage' },
      { name: 'lines', desc: 'LoadingSkeleton row count' },
    ],
  },
  {
    id: 'avatar',
    category: 'data',
    name: 'Avatar',
    exportsLabel: 'Avatar',
    importNames: ['Avatar'],
    badge: { label: 'identity', tone: 'neutral' },
    stage: (
      <>
        <Avatar alt="Nimi" fallback="N" />
        <Avatar alt="Tester" fallback="T" shape="rounded" tone="accent" />
        <Avatar alt="Agent" fallback="A" size="lg" />
      </>
    ),
    snippet: `<>
  <Avatar alt="Nimi" fallback="N" />
  <Avatar alt="Tester" fallback="T" shape="rounded" tone="accent" />
  <Avatar alt="Agent" fallback="A" size="lg" />
</>`,
    props: [
      { name: 'src / alt', desc: 'image + accessible name' },
      { name: 'shape', desc: 'circle | rounded | square' },
      { name: 'size', desc: 'sm | md | lg' },
    ],
  },
  {
    id: 'empty',
    category: 'data',
    name: 'EmptyState',
    exportsLabel: 'EmptyState',
    importNames: ['EmptyState', 'Button'],
    badge: { label: 'empty', tone: 'neutral' },
    wide: true,
    stage: (
      <EmptyState
        icon={<Boxes size={18} />}
        title="No captured artifacts"
        description="Run a real capability or resolve a typed blocker before this list fills."
        action={<Button size="sm" tone="secondary" leadingIcon={<RefreshCw size={13} />}>Refresh</Button>}
      />
    ),
    extraImports: ["import { Boxes, RefreshCw } from 'lucide-react';"],
    snippet: `<EmptyState
  icon={<Boxes size={18} />}
  title="No captured artifacts"
  description="Run a real capability or resolve a typed blocker before this list fills."
  action={
    <Button size="sm" tone="secondary" leadingIcon={<RefreshCw size={13} />}>
      Refresh
    </Button>
  }
/>`,
    props: [
      { name: 'title / description', desc: 'empty-state copy' },
      { name: 'action', desc: 'the action that populates the surface' },
    ],
  },
  {
    id: 'timeline',
    category: 'data',
    name: 'Timeline',
    exportsLabel: 'Timeline, TimelineGroup',
    importNames: ['Timeline', 'TimelineGroup'],
    badge: { label: 'evidence', tone: 'info' },
    wide: true,
    stage: (
      <Timeline>
        <TimelineGroup date="Today" secondaryLabel="21:51">
          <div className="kit-tl-item"><strong>Runtime session ready</strong><span>SDK admission surface available</span></div>
        </TimelineGroup>
        <TimelineGroup date="Earlier" secondaryLabel="21:40" isLast>
          <div className="kit-tl-item"><strong>Capability blocked</strong><span>NimiAIConfig binding required</span></div>
        </TimelineGroup>
      </Timeline>
    ),
    snippet: `<Timeline>
  <TimelineGroup date="Today" secondaryLabel="21:51">
    <div className="kit-tl-item">
      <strong>Runtime session ready</strong>
      <span>SDK admission surface available</span>
    </div>
  </TimelineGroup>
  <TimelineGroup date="Earlier" secondaryLabel="21:40" isLast>
    <div className="kit-tl-item">
      <strong>Capability blocked</strong>
      <span>NimiAIConfig binding required</span>
    </div>
  </TimelineGroup>
</Timeline>`,
    props: [
      { name: 'date', desc: 'TimelineGroup heading' },
      { name: 'secondaryLabel', desc: 'right-aligned meta' },
      { name: 'isLast', desc: 'omit the trailing connector' },
    ],
  },
];
