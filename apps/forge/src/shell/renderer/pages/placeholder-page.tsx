import { ForgePage, ForgePageHeader, ForgeEmptyState } from '@renderer/components/page-layout.js';

export function PlaceholderPage({ title }: { title: string }) {
  return (
    <ForgePage>
      <ForgePageHeader title={title} />
      <ForgeEmptyState message="This page is under construction." />
    </ForgePage>
  );
}
