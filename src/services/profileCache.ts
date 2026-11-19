import type { User } from '../types/index.ts';
import type { QueryCache } from './queryCache.ts';

export function updateProfileQueries(cache: QueryCache, cachePrefix: string, user: User): void {
  cache.updateMatching(cachePrefix, (key, snapshot) => {
    const resource = key.slice(cachePrefix.length);
    if (resource === '/users') {
      const users = Array.isArray(snapshot.data) ? snapshot.data as User[] : [];
      return {
        ...snapshot,
        data: users.map((cachedUser) => cachedUser.id === user.id ? user : cachedUser),
      };
    }
    if (resource === `/users/${encodeURIComponent(user.username)}`) {
      const cachedUser = snapshot.data as (User & { isFollowing?: boolean }) | undefined;
      return {
        ...snapshot,
        data: {
          ...user,
          ...(typeof cachedUser?.isFollowing === 'boolean'
            ? { isFollowing: cachedUser.isFollowing }
            : {}),
        },
      };
    }
    return null;
  });
}
