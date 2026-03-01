export function getStatusBadgeStyle(status: string): { bg: string; text: string } {
  switch (status) {
    case 'ACTIVE':
      return { bg: 'bg-green-100', text: 'text-green-700' };
    case 'DRAFT':
      return { bg: 'bg-yellow-100', text: 'text-yellow-700' };
    case 'PENDING_REVIEW':
      return { bg: 'bg-blue-100', text: 'text-blue-700' };
    case 'SUSPENDED':
      return { bg: 'bg-red-100', text: 'text-red-700' };
    case 'ARCHIVED':
      return { bg: 'bg-gray-100', text: 'text-gray-600' };
    default:
      return { bg: 'bg-gray-100', text: 'text-gray-600' };
  }
}

export function getWorldInitial(name: string): string {
  return name.charAt(0).toUpperCase();
}
