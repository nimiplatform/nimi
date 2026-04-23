export function shouldDismissFloatingMenu(input: {
  container: { contains: (target: Node | null) => boolean } | null;
  target: EventTarget | null;
}): boolean {
  if (!input.container) {
    return true;
  }
  if (!input.target) {
    return true;
  }
  return !input.container.contains(input.target as Node);
}
