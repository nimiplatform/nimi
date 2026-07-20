export function createNimiReadonlySet<TValue>(values: Iterable<TValue>): ReadonlySet<TValue> {
  const internal = new Set(values);
  let view: ReadonlySet<TValue>;
  view = Object.freeze({
    get size() {
      return internal.size;
    },
    has(value: TValue) {
      return internal.has(value);
    },
    entries() {
      return internal.entries();
    },
    keys() {
      return internal.keys();
    },
    values() {
      return internal.values();
    },
    forEach(
      callback: (value: TValue, value2: TValue, set: ReadonlySet<TValue>) => void,
      thisArg?: object,
    ) {
      internal.forEach((value) => callback.call(thisArg, value, value, view));
    },
    [Symbol.iterator]() {
      return internal[Symbol.iterator]();
    },
  });
  return view;
}
