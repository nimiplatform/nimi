export function PlaceholderPage({ title }: { title: string }) {
  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold text-white">{title}</h1>
      <p className="mt-2 text-neutral-500 text-sm">This page is under construction.</p>
    </div>
  );
}
