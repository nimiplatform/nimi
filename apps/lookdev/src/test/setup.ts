import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, vi } from 'vitest';

type StorageLike = {
  clear: () => void;
  getItem: (key: string) => string | null;
  key: (index: number) => string | null;
  readonly length: number;
  removeItem: (key: string) => void;
  setItem: (key: string, value: string) => void;
};

function createMemoryStorage(): StorageLike {
  const values = new Map<string, string>();
  return {
    clear: () => {
      values.clear();
    },
    getItem: (key: string) => values.get(String(key)) ?? null,
    key: (index: number) => Array.from(values.keys())[index] ?? null,
    get length() {
      return values.size;
    },
    removeItem: (key: string) => {
      values.delete(String(key));
    },
    setItem: (key: string, value: string) => {
      values.set(String(key), String(value));
    },
  };
}

const localStorageStub = createMemoryStorage();
const sessionStorageStub = createMemoryStorage();

vi.stubGlobal('localStorage', localStorageStub);
vi.stubGlobal('sessionStorage', sessionStorageStub);

beforeEach(() => {
  localStorageStub.clear();
  sessionStorageStub.clear();
});

afterEach(() => {
  localStorageStub.clear();
  sessionStorageStub.clear();
});
