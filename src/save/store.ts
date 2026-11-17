/**
 * Small persistence layer.
 *
 * IndexedDB is the primary store (structured data, larger quota). A
 * localStorage fallback keeps settings working in privacy modes where
 * IndexedDB is unavailable.
 */

const DB_NAME = 'browser-drive';
const DB_VERSION = 1;
const STORE = 'kv';
const FALLBACK_PREFIX = 'browser-drive:';

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDatabase(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function readFallback<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(FALLBACK_PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeFallback(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(FALLBACK_PREFIX + key, JSON.stringify(value));
  } catch {
    // Storage unavailable; settings simply will not persist.
  }
}

export async function readValue<T>(key: string): Promise<T | null> {
  const db = await openDatabase();
  if (!db) return readFallback<T>(key);
  try {
    return await new Promise<T | null>((resolve) => {
      const transaction = db.transaction(STORE, 'readonly');
      const request = transaction.objectStore(STORE).get(key);
      request.onsuccess = () => {
        const result = request.result as T | undefined;
        resolve(result ?? readFallback<T>(key));
      };
      request.onerror = () => resolve(readFallback<T>(key));
    });
  } catch {
    return readFallback<T>(key);
  }
}

export async function writeValue(key: string, value: unknown): Promise<void> {
  const db = await openDatabase();
  if (!db) {
    writeFallback(key, value);
    return;
  }
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, 'readwrite');
      transaction.objectStore(STORE).put(value, key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB write failed'));
    });
  } catch {
    writeFallback(key, value);
  }
}
