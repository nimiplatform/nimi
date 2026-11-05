export type ContentCheckDemo = {
  draft: string;
  phase: 'draft' | 'blocked' | 'editing' | 'submitted';
};
type Action =
  | { type: 'change'; text: string }
  | { type: 'submit'; marker: string }
  | { type: 'edit' }
  | { type: 'remove-example'; marker: string };

/** Only the disclosed example marker drives this illustration. This is not a credential detector. */
export function reduceContentCheckDemo(state: ContentCheckDemo, action: Action): ContentCheckDemo {
  switch (action.type) {
    case 'change':
      return state.phase === 'blocked' ? state : { draft: action.text, phase: 'editing' };
    case 'edit':
      return { ...state, phase: 'editing' };
    case 'remove-example':
      return state.phase === 'editing' ? { ...state, draft: state.draft.replaceAll(`\n${action.marker}`, '').replaceAll(action.marker, '') } : state;
    case 'submit':
      if (state.phase === 'blocked' || !state.draft.trim()) return state;
      return state.draft.includes(action.marker)
        ? { ...state, phase: 'blocked' }
        : { draft: '', phase: 'submitted' };
  }
}
