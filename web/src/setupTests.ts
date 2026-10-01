import '@testing-library/jest-dom';

if (typeof globalThis.localStorage === 'undefined' || globalThis.localStorage === null) {
  const storage: Record<string, string> = {};
  globalThis.localStorage = {
    getItem: (key: string) => storage[key] ?? null,
    setItem: (key: string, value: string) => {
      storage[key] = value.toString();
    },
    removeItem: (key: string) => {
      delete storage[key];
    },
    clear: () => {
      for (const k in storage) delete storage[k];
    },
    key: (index: number) => Object.keys(storage)[index] ?? null,
    get length() {
      return Object.keys(storage).length;
    },
  } as Storage;
}

