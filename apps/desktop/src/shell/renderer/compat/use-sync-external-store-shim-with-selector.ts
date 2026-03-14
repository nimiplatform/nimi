import {
  useDebugValue,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from 'react';

function is(x: unknown, y: unknown): boolean {
  return (x === y && (x !== 0 || 1 / (x as number) === 1 / (y as number))) || (x !== x && y !== y);
}

const objectIs = typeof Object.is === 'function' ? Object.is : is;

type StoreChangeListener = () => void;
type Subscribe = (onStoreChange: StoreChangeListener) => () => void;
type Selector<Snapshot, Selection> = (snapshot: Snapshot) => Selection;
type EqualityFn<Selection> = (a: Selection, b: Selection) => boolean;

type SelectorInst<Selection> = {
  hasValue: boolean;
  value: Selection | null;
};

export function useSyncExternalStoreWithSelector<Snapshot, Selection>(
  subscribe: Subscribe,
  getSnapshot: () => Snapshot,
  getServerSnapshot: (() => Snapshot) | undefined,
  selector: Selector<Snapshot, Selection>,
  isEqual?: EqualityFn<Selection>,
): Selection {
  const instRef = useRef<SelectorInst<Selection> | null>(null);
  if (instRef.current === null) {
    instRef.current = {
      hasValue: false,
      value: null,
    };
  }
  const inst = instRef.current;

  const [getSelectionSnapshot, getServerSelectionSnapshot] = useMemo(() => {
    let hasMemo = false;
    let memoizedSnapshot: Snapshot;
    let memoizedSelection: Selection;

    const memoizedSelector = (nextSnapshot: Snapshot): Selection => {
      if (!hasMemo) {
        hasMemo = true;
        memoizedSnapshot = nextSnapshot;
        const nextSelection = selector(nextSnapshot);
        if (isEqual !== undefined && inst.hasValue) {
          const currentSelection = inst.value as Selection;
          if (isEqual(currentSelection, nextSelection)) {
            memoizedSelection = currentSelection;
            return currentSelection;
          }
        }
        memoizedSelection = nextSelection;
        return nextSelection;
      }

      const currentSelection = memoizedSelection;
      if (objectIs(memoizedSnapshot, nextSnapshot)) {
        return currentSelection;
      }

      const nextSelection = selector(nextSnapshot);
      if (isEqual !== undefined && isEqual(currentSelection, nextSelection)) {
        memoizedSnapshot = nextSnapshot;
        return currentSelection;
      }

      memoizedSnapshot = nextSnapshot;
      memoizedSelection = nextSelection;
      return nextSelection;
    };

    const maybeGetServerSelectionSnapshot = getServerSnapshot
      ? () => memoizedSelector(getServerSnapshot())
      : undefined;

    return [
      () => memoizedSelector(getSnapshot()),
      maybeGetServerSelectionSnapshot,
    ] as const;
  }, [getServerSnapshot, getSnapshot, inst, isEqual, selector]);

  const value = useSyncExternalStore(
    subscribe,
    getSelectionSnapshot,
    getServerSelectionSnapshot,
  );

  useEffect(() => {
    inst.hasValue = true;
    inst.value = value;
  }, [inst, value]);

  useDebugValue(value);
  return value;
}

const shimWithSelectorExports = {
  useSyncExternalStoreWithSelector,
};

export default shimWithSelectorExports;
