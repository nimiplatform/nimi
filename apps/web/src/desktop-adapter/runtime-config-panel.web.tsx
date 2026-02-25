function RuntimeUnavailableNotice() {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center bg-gray-50 p-6">
      <div className="max-w-md rounded-[10px] border border-gray-200 bg-white px-5 py-4 text-sm text-gray-600">
        AI Runtime settings are only available in Nimi Desktop.
      </div>
    </div>
  );
}

export function RuntimeConfigPanelBody() {
  return <RuntimeUnavailableNotice />;
}

export function RuntimeConfigPanelView(_props: { model: unknown }) {
  return <RuntimeUnavailableNotice />;
}
