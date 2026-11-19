export interface QuerySnapshot<T = unknown> {
  data?: T;
  error?: unknown;
  updatedAt?: number;
  expiresAt?: number;
  invalidationVersion: number;
  isFetching: boolean;
}

const EMPTY_SNAPSHOT: QuerySnapshot = Object.freeze({
  invalidationVersion: 0,
  isFetching: false,
});

export class QueryCache {
  private readonly snapshots = new Map<string, QuerySnapshot>();
  private readonly requests = new Map<string, Promise<unknown>>();
  private readonly listeners = new Map<string, Set<() => void>>();
  private epoch = 0;

  getSnapshot<T>(key: string): QuerySnapshot<T> {
    return (this.snapshots.get(key) as QuerySnapshot<T> | undefined) ??
      (EMPTY_SNAPSHOT as QuerySnapshot<T>);
  }

  subscribe(key: string, listener: () => void): () => void {
    let listeners = this.listeners.get(key);
    if (!listeners) {
      listeners = new Set();
      this.listeners.set(key, listeners);
    }
    listeners.add(listener);
    return () => {
      listeners?.delete(listener);
      if (listeners?.size === 0) this.listeners.delete(key);
    };
  }

  fetch<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
    const snapshot = this.getSnapshot<T>(key);
    if (snapshot.data !== undefined && (snapshot.expiresAt ?? 0) > Date.now()) {
      return Promise.resolve(snapshot.data);
    }

    const request = this.requests.get(key) as Promise<T> | undefined;
    if (snapshot.data !== undefined) {
      if (!request) void this.load(key, ttlMs, loader).catch(() => undefined);
      return Promise.resolve(snapshot.data);
    }
    if (request) return request;
    return this.load(key, ttlMs, loader);
  }

  invalidate(key: string): void {
    const snapshot = this.getSnapshot(key);
    this.setSnapshot(key, {
      ...snapshot,
      expiresAt: 0,
      invalidationVersion: snapshot.invalidationVersion + 1,
    });
  }

  updateMatching(
    prefix: string,
    update: (key: string, snapshot: QuerySnapshot) => QuerySnapshot | null,
  ): void {
    for (const [key, snapshot] of this.snapshots) {
      if (!key.startsWith(prefix)) continue;
      const next = update(key, snapshot);
      if (next) {
        this.setSnapshot(key, {
          ...next,
          invalidationVersion: next.invalidationVersion === snapshot.invalidationVersion
            ? snapshot.invalidationVersion + 1
            : next.invalidationVersion,
        });
      }
    }
  }

  clear(): void {
    this.epoch += 1;
    this.snapshots.clear();
    this.requests.clear();
    for (const key of this.listeners.keys()) this.notify(key);
  }

  private load<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
    const epoch = this.epoch;
    const requestVersion = this.getSnapshot(key).invalidationVersion;
    let resourceChangedDuringRequest = false;
    this.setSnapshot(key, { ...this.getSnapshot(key), error: undefined, isFetching: true });

    const request = loader()
      .then((data) => {
        if (epoch !== this.epoch) return data;
        const current = this.getSnapshot(key);
        if (current.invalidationVersion !== requestVersion) {
          resourceChangedDuringRequest = true;
          this.setSnapshot(key, { ...current, isFetching: false });
          return data;
        }
        this.setSnapshot(key, {
          data,
          updatedAt: Date.now(),
          expiresAt: Date.now() + ttlMs,
          invalidationVersion: requestVersion,
          isFetching: false,
        });
        return data;
      })
      .catch((error: unknown) => {
        if (epoch !== this.epoch) throw error;
        const snapshot = this.getSnapshot(key);
        this.setSnapshot(key, { ...snapshot, error, isFetching: false });
        throw error;
      })
      .finally(() => {
        if (this.requests.get(key) === request) this.requests.delete(key);
        if (
          resourceChangedDuringRequest &&
          epoch === this.epoch &&
          (this.getSnapshot(key).expiresAt ?? 0) <= Date.now()
        ) {
          queueMicrotask(() => {
            void this.fetch(key, ttlMs, loader).catch(() => undefined);
          });
        }
      });

    this.requests.set(key, request);
    return request;
  }

  private setSnapshot(key: string, snapshot: QuerySnapshot): void {
    this.snapshots.set(key, snapshot);
    if (this.snapshots.size > 200) this.prune();
    this.notify(key);
  }

  private prune(): void {
    const now = Date.now();
    for (const [key, snapshot] of this.snapshots) {
      if ((snapshot.expiresAt ?? 0) < now && !this.listeners.has(key)) {
        this.snapshots.delete(key);
      }
    }
    while (this.snapshots.size > 200) {
      const oldest = this.snapshots.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.snapshots.delete(oldest);
    }
  }

  private notify(key: string): void {
    this.listeners.get(key)?.forEach((listener) => listener());
  }
}

export const queryCache = new QueryCache();
