import { createAdapter } from '@socket.io/postgres-adapter';
import type { Pool, PoolClient, QueryResult } from 'pg';
import type { Server as SocketServer } from 'socket.io';
import { getRealtimeAdapterPool } from './db/pool.ts';

const CHANNEL_PREFIX = 'socket.io';
const DEFAULT_STARTUP_TIMEOUT_MS = 15_000;
const DEFAULT_CLUSTER_DISCOVERY_WAIT_MS = 5_500;

export interface RealtimeAdapterTiming {
  startupTimeoutMs?: number;
  clusterDiscoveryWaitMs?: number;
}

export interface RealtimeAdapterHandle {
  isReady(): boolean;
  waitForCluster(): Promise<void>;
  close(): Promise<void>;
}

interface AdapterClientState {
  client: PoolClient;
  released: boolean;
  adapterEndListeners: Set<(...args: unknown[]) => void>;
  ownListeners: Array<{ event: string; listener: (...args: unknown[]) => void }>;
}

const CLOSED = Symbol('closed');
type ClosedMarker = typeof CLOSED;
const NEVER = new Promise<never>(() => {});

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

interface AdapterPoolController {
  pool: Pool;
  close: () => Promise<void>;
}

function createManagedAdapterPool(
  pool: Pool,
  hooks: {
    onListening: () => void;
    onUnavailable: (error?: Error) => void;
    onClose: () => Promise<void>;
  },
): AdapterPoolController {
  const liveClients = new Set<AdapterClientState>();
  const pendingAcquisitions = new Set<Promise<void>>();
  let closed = false;
  let closePromise: Promise<void> | undefined;

  const releaseClient = (state: AdapterClientState, destroy: boolean): void => {
    if (state.released) return;
    state.released = true;
    liveClients.delete(state);
    for (const listener of state.adapterEndListeners) {
      state.client.removeListener('end', listener);
    }
    state.adapterEndListeners.clear();
    for (const { event, listener } of state.ownListeners) {
      state.client.removeListener(event, listener);
    }
    state.ownListeners = [];
    try {
      state.client.release(destroy);
    } catch {
      // The pool may already have destroyed the connection. Releasing twice is
      // never attempted, but a connection in an unknown state may throw here.
    }
  };

  const releaseRawClient = (client: PoolClient): void => {
    try {
      client.release(true);
    } catch {
      // See releaseClient: a connection with uncertain state may already be gone.
    }
  };

  const createClientProxy = (state: AdapterClientState): PoolClient => {
    const target = state.client;
    return new Proxy(target, {
      get(clientTarget, property) {
        if (property === 'query') {
          return async (...args: unknown[]): Promise<QueryResult> => {
            const isListen =
              typeof args[0] === 'string' &&
              args[0].trim().toUpperCase().startsWith('LISTEN ');
            if (isListen && (closed || state.released)) return NEVER;
            try {
              const query = Reflect.get(clientTarget, property, clientTarget) as (
                ...queryArgs: unknown[]
              ) => Promise<QueryResult>;
              const result = await query.apply(clientTarget, args);
              if (isListen) {
                if (closed || state.released) {
                  releaseClient(state, true);
                  return NEVER;
                }
                hooks.onListening();
              }
              return result;
            } catch (error) {
              if (isListen) {
                if (closed || state.released) return NEVER;
                hooks.onUnavailable(asError(error));
                releaseClient(state, true);
                throw error;
              }
              throw error;
            }
          };
        }
        if (property === 'release') {
          return (destroy?: boolean) => releaseClient(state, Boolean(destroy));
        }
        if (property === 'on' || property === 'once') {
          return (event: string, listener: (...listenerArgs: unknown[]) => void) => {
            if (event === 'end') state.adapterEndListeners.add(listener);
            const register = Reflect.get(clientTarget, property, clientTarget) as (
              eventName: string,
              handler: (...handlerArgs: unknown[]) => void,
            ) => unknown;
            return register.call(clientTarget, event, listener);
          };
        }
        const value = Reflect.get(clientTarget, property, clientTarget);
        return typeof value === 'function' ? value.bind(clientTarget) : value;
      },
    }) as PoolClient;
  };

  const attachClient = (client: PoolClient): AdapterClientState => {
    const state: AdapterClientState = {
      client,
      released: false,
      adapterEndListeners: new Set(),
      ownListeners: [],
    };
    const handleEnd = () => {
      hooks.onUnavailable(new Error('Realtime PostgreSQL listener disconnected.'));
      releaseClient(state, true);
    };
    const handleError = (error: Error) => {
      hooks.onUnavailable(error);
    };
    client.on('end', handleEnd);
    client.on('error', handleError);
    state.ownListeners.push(
      { event: 'end', listener: handleEnd },
      { event: 'error', listener: handleError as (...args: unknown[]) => void },
    );
    liveClients.add(state);
    return state;
  };

  const managedPool = new Proxy(pool, {
    get(target, property) {
      if (property === 'connect') {
        return async (): Promise<PoolClient> => {
          if (closed) return NEVER;
          let acquisition: Promise<PoolClient>;
          try {
            acquisition = target.connect();
          } catch (error) {
            if (closed) return NEVER;
            hooks.onUnavailable(asError(error));
            throw error;
          }
          const outcome: Promise<PoolClient | ClosedMarker> = (async () => {
            let client: PoolClient;
            try {
              client = await acquisition;
            } catch (error) {
              if (closed) return CLOSED;
              hooks.onUnavailable(asError(error));
              throw error;
            }
            if (closed) {
              releaseRawClient(client);
              return CLOSED;
            }
            const state = attachClient(client);
            return createClientProxy(state);
          })();
          const settled = outcome.then(
            () => undefined,
            () => undefined,
          );
          pendingAcquisitions.add(settled);
          void settled.finally(() => pendingAcquisitions.delete(settled));
          const result = await outcome;
          return result === CLOSED ? NEVER : result;
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) as Pool;

  const close = (): Promise<void> => {
    if (closePromise) return closePromise;
    closed = true;
    closePromise = (async () => {
      await Promise.allSettled([...pendingAcquisitions]);
      await hooks.onClose();
      for (const state of [...liveClients]) releaseClient(state, true);
    })();
    return closePromise;
  };

  return { pool: managedPool, close };
}

export async function attachPostgresRealtimeAdapter(
  io: SocketServer,
  pool: Pool = getRealtimeAdapterPool(),
  onReadyChange: (ready: boolean) => void = () => {},
  timing: RealtimeAdapterTiming = {},
): Promise<RealtimeAdapterHandle> {
  let ready = false;
  let resolveReady!: () => void;
  let rejectReady!: (error: Error) => void;
  const startupTimeoutMs = timing.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS;
  const clusterDiscoveryWaitMs =
    timing.clusterDiscoveryWaitMs ?? DEFAULT_CLUSTER_DISCOVERY_WAIT_MS;
  const readyPromise = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  let startupTimer: NodeJS.Timeout | undefined = setTimeout(() => {
    rejectReady(new Error('Timed out waiting for the PostgreSQL realtime adapter LISTEN connection.'));
  }, startupTimeoutMs);
  startupTimer.unref();

  const markReady = () => {
    ready = true;
    onReadyChange(true);
    if (startupTimer) clearTimeout(startupTimer);
    startupTimer = undefined;
    resolveReady();
  };
  const markUnavailable = (error?: Error) => {
    if (ready) onReadyChange(false);
    ready = false;
    if (error) {
      console.error('[realtime-adapter] PostgreSQL transport unavailable:', error.message);
    }
  };

  let ioClosed = false;
  const controller = createManagedAdapterPool(pool, {
    onListening: markReady,
    onUnavailable: markUnavailable,
    onClose: async () => {
      if (ioClosed) return;
      ioClosed = true;
      await new Promise<void>((resolve) => io.close(() => resolve()));
    },
  });

  io.adapter(createAdapter(controller.pool, {
    channelPrefix: CHANNEL_PREFIX,
    errorHandler: (error) => {
      console.error('[realtime-adapter] PostgreSQL adapter operation failed:', error.message);
    },
  }));

  const shutdown = async (): Promise<void> => {
    if (startupTimer) clearTimeout(startupTimer);
    startupTimer = undefined;
    await controller.close();
  };

  try {
    await readyPromise;
    await pool.query('SELECT pg_notify($1, $2)', [
      'zunari:realtime:startup-probe',
      JSON.stringify({ type: 'startup-probe' }),
    ]);
  } catch (error) {
    await shutdown();
    throw error;
  }

  return {
    isReady: () => ready,
    async waitForCluster() {
      await new Promise<void>((resolve) => setTimeout(resolve, clusterDiscoveryWaitMs));
      if (!ready) throw new Error('PostgreSQL realtime adapter disconnected during startup.');
      await io.serverSideEmitWithAck('zunari:realtime:adapter-probe');
      if (!ready) throw new Error('PostgreSQL realtime adapter disconnected during startup.');
    },
    close: shutdown,
  };
}
