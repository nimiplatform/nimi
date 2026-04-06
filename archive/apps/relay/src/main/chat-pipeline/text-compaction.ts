export function compactHeadTail(text: string, limit: number): string {
  const input = String(text || '');
  const normalizedLimit = Math.max(0, Math.floor(limit));
  if (normalizedLimit <= 0) return '';
  if (input.length <= normalizedLimit) return input;
  if (normalizedLimit === 1) return '…';
  const headLen = Math.ceil(normalizedLimit * 0.7);
  const tailLen = Math.max(0, normalizedLimit - headLen - 1);
  const safeHeadLen = Math.min(headLen, Math.max(0, normalizedLimit - 1));
  return input.slice(0, safeHeadLen) + '…' + (tailLen > 0 ? input.slice(-tailLen) : '');
}
