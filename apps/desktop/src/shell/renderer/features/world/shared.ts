export function getStatusBadgeStyle(status: string): { bg: string; text: string } {
  switch (status) {
    case 'DISCOVERABLE':
      return { bg: 'bg-green-100', text: 'text-green-700' };
    case 'PUBLIC':
      return { bg: 'bg-blue-100', text: 'text-blue-700' };
    case 'SYSTEM':
      return { bg: 'bg-gray-100', text: 'text-gray-600' };
    default:
      return { bg: 'bg-gray-100', text: 'text-gray-600' };
  }
}

export function getWorldInitial(name: string): string {
  return name.charAt(0).toUpperCase();
}

export function normalizeWorldType(type: string | null | undefined): string {
  return String(type || '').trim().toUpperCase();
}

export function isMainWorldType(type: string | null | undefined): boolean {
  const normalized = normalizeWorldType(type);
  return normalized === 'OASIS'
    || normalized === 'MAIN'
    || normalized === 'MAIN_WORLD'
    || normalized === 'PRIMARY'
    || normalized === 'ROOT';
}

export function getStatusDotColor(status: string): string {
  switch (status) {
    case 'DISCOVERABLE':
      return 'bg-green-500';
    case 'PUBLIC':
      return 'bg-blue-500';
    case 'SYSTEM':
      return 'bg-gray-500';
    default:
      return 'bg-gray-500';
  }
}
