/**
 * Safe storage wrapper with fallback to in-memory storage if localStorage/sessionStorage are blocked.
 */

type StorageType = 'local' | 'session';

class MemoryStorage implements Storage {
  private data: Map<string, string> = new Map();

  get length(): number {
    return this.data.size;
  }

  clear(): void {
    this.data.clear();
  }

  getItem(key: string): string | null {
    return this.data.has(key) ? this.data.get(key)! : null;
  }

  key(index: number): string | null {
    const keys = Array.from(this.data.keys());
    return keys[index] ?? null;
  }

  removeItem(key: string): void {
    this.data.delete(key);
  }

  setItem(key: string, value: string): void {
    this.data.set(key, String(value));
  }
}

const memoryLocalStorage = new MemoryStorage();
const memorySessionStorage = new MemoryStorage();

let isStorageBlocked = false;
const listeners: Array<(blocked: boolean) => void> = [];

export function subscribeStorageStatus(listener: (blocked: boolean) => void): () => void {
  listeners.push(listener);
  listener(isStorageBlocked);
  return () => {
    const idx = listeners.indexOf(listener);
    if (idx !== -1) listeners.splice(idx, 1);
  };
}

function notifyStorageStatus(blocked: boolean) {
  if (isStorageBlocked !== blocked) {
    isStorageBlocked = blocked;
    listeners.forEach((fn) => fn(blocked));
  }
}

function getNativeStorage(type: StorageType): Storage | null {
  try {
    const storage = type === 'local' ? window.localStorage : window.sessionStorage;
    const testKey = `__test_storage_${Date.now()}__`;
    storage.setItem(testKey, '1');
    storage.removeItem(testKey);
    return storage;
  } catch {
    notifyStorageStatus(true);
    return null;
  }
}

export const safeStorage = {
  isBlocked(): boolean {
    return isStorageBlocked;
  },

  getItem(type: StorageType, key: string): string | null {
    const native = getNativeStorage(type);
    if (native) {
      try {
        return native.getItem(key);
      } catch {
        notifyStorageStatus(true);
      }
    }
    return type === 'local' ? memoryLocalStorage.getItem(key) : memorySessionStorage.getItem(key);
  },

  setItem(type: StorageType, key: string, value: string): boolean {
    const native = getNativeStorage(type);
    if (native) {
      try {
        native.setItem(key, value);
        return true;
      } catch {
        notifyStorageStatus(true);
      }
    }
    const mem = type === 'local' ? memoryLocalStorage : memorySessionStorage;
    mem.setItem(key, value);
    return true;
  },

  removeItem(type: StorageType, key: string): void {
    const native = getNativeStorage(type);
    if (native) {
      try {
        native.removeItem(key);
      } catch {
        notifyStorageStatus(true);
      }
    }
    const mem = type === 'local' ? memoryLocalStorage : memorySessionStorage;
    mem.removeItem(key);
  },

  clear(type: StorageType): void {
    const native = getNativeStorage(type);
    if (native) {
      try {
        native.clear();
      } catch {
        notifyStorageStatus(true);
      }
    }
    const mem = type === 'local' ? memoryLocalStorage : memorySessionStorage;
    mem.clear();
  }
};
