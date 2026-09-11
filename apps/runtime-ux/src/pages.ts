export type PageId = 'home' | 'answers' | 'personality' | 'usage' | 'status';

export const pageOrder: { id: PageId; label: string }[] = [
  { id: 'home', label: 'Home' },
  { id: 'answers', label: 'Answers' },
  { id: 'personality', label: 'Personality' },
  { id: 'usage', label: 'Usage & Access' },
  { id: 'status', label: 'Status' },
];
