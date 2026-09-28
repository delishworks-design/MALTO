/**
 * Caches the partner's own portal data so the app can open without a network.
 *
 * Scope, and the reason for it
 * ---------------------------
 * Read-only, on purpose. When an app shows a job list from a cache and then
 * lets someone accept a job, the worst outcome is a partner driving to an
 * address for a job that was given away half an hour ago. The banner that comes
 * with this says so, but a banner is a weak guarantee against a tired person in
 * a hurry. So the cached data is displayed and never acted on: everything that
 * writes goes to the server and needs a live connection.
 *
 * Where this is stored
 * --------------------
 * IndexedDB, not localStorage. my_assignments() returns a row per assignment
 * with addresses, notes and photo paths; a few hundred of those will exceed
 * the roughly 5MB localStorage budget on a mid-range phone, and losing the
 * write is exactly the failure that would break the feature it exists to
 * support. IndexedDB has no such ceiling.
 *
 * The key is the user id. A shared family phone can have two partners signed in
 * in turn, and showing one person's jobs to the other would be a data leak that
 * no RLS can catch, because it never touches the database.
 */

const DB_NAME = "malto-portal";
const DB_VERSION = 1;
const STORE = "snapshot";

export type Snapshot = {
  /** Epoch ms of the successful fetch this came from. */
  at: number;
  me: Record<string, unknown> | null;
  assignments: Record<string, unknown>[];
  /** The app build that wrote it, so a schema change can invalidate rather than misread. */
  version: string;
};

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("no IndexedDB"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("could not open the cache"));
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error("cache request failed"));
    });
  } finally {
    db.close();
  }
}

export async function readSnapshot(userId: string): Promise<Snapshot | null> {
  try {
    const value = (await withStore<Snapshot | undefined>("readonly", (s) => s.get(userId))) ?? null;
    return value;
  } catch {
    // Private browsing, or storage disabled. Offline is a nicety; failing to
    // open a cache must never stop the portal working.
    return null;
  }
}

export async function writeSnapshot(userId: string, snapshot: Snapshot): Promise<void> {
  try {
    await withStore("readwrite", (s) => s.put(snapshot, userId));
  } catch {
    /* nothing to do; the online path does not depend on this */
  }
}

/** Drop a partner's cache. Used on sign out, so the next person cannot see it. */
export async function clearSnapshot(userId: string): Promise<void> {
  try {
    await withStore("readwrite", (s) => s.delete(userId));
  } catch {
    /* ignore */
  }
}

/** How old the cache is, phrased for a person rather than a timestamp. */
export function cacheAge(at: number): string {
  const minutes = Math.floor((Date.now() - at) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/** True when the cache is too old to trust even for reading. */
export function isStale(at: number, maxAgeMinutes = 720): boolean {
  return Date.now() - at > maxAgeMinutes * 60000;
}
