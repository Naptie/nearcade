// routeCacheDB.ts
// Handles route cache storage using IndexedDB

import { ROUTE_CACHE_EXPIRY_HOURS } from '$lib/constants';

const DB_NAME = 'nearcade';
const DB_VERSION = 1;

type CacheEntry<T> = {
  key: string;
  data: T;
  expiresAt: number;
};

export class Database {
  private static dbPromise: Promise<IDBDatabase>;

  static getStore(name: string): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(name)) {
            db.createObjectStore(name, { keyPath: 'key' });
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    }
    return this.dbPromise;
  }

  static async get<T>(storeName: string, key: string): Promise<T | null> {
    const db = await this.getStore(storeName);
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result ? req.result.data : null);
      req.onerror = () => reject(req.error);
    });
  }

  static async set<T>(storeName: string, key: string, data: T): Promise<void> {
    const db = await this.getStore(storeName);
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const req = store.put({
        key,
        data: JSON.parse(JSON.stringify(data)),
        expiresAt: Date.now() + ROUTE_CACHE_EXPIRY_HOURS * 60 * 60 * 1000
      });
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  static async delete(storeName: string, key: string): Promise<void> {
    const db = await this.getStore(storeName);
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const req = store.delete(key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  static async getAllKeys<T>(storeName: string): Promise<{ key: string; expiresAt: number }[]> {
    const db = await this.getStore(storeName);
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const req = store.getAll();
      req.onsuccess = () => {
        const result = req.result.map((entry: CacheEntry<T>) => ({
          key: entry.key,
          expiresAt: entry.expiresAt
        }));
        resolve(result);
      };
      req.onerror = () => reject(req.error);
    });
  }

  static async clearExpired(storeName: string, now: number): Promise<number> {
    const db = await this.getStore(storeName);
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const req = store.getAll();
      req.onsuccess = () => {
        let cleared = 0;
        for (const entry of req.result) {
          if (now > entry.expiresAt) {
            store.delete(entry.key);
            cleared++;
          }
        }
        resolve(cleared);
      };
      req.onerror = () => reject(req.error);
    });
  }

  static async clearEarliest<T>(storeName: string, n: number): Promise<number> {
    const db = await this.getStore(storeName);
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const req = store.getAll();
      req.onsuccess = () => {
        const sorted = req.result.sort(
          (a: CacheEntry<T>, b: CacheEntry<T>) => a.expiresAt - b.expiresAt
        );
        let cleared = 0;
        for (let i = 0; i < n && i < sorted.length; i++) {
          store.delete(sorted[i].key);
          cleared++;
        }
        resolve(cleared);
      };
      req.onerror = () => reject(req.error);
    });
  }
}
