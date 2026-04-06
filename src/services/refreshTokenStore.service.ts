import { env } from '../config/env.js';
import { cacheService } from './cache.service.js';

function parseDurationToSeconds(duration: string): number {
  const value = String(duration || '').trim();
  const match = value.match(/^(\d+)([smhd])$/i);

  if (!match) {
    const numeric = Number.parseInt(value, 10);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : 60 * 60 * 24 * 7;
  }

  const amount = Number.parseInt(match[1], 10);
  const unit = match[2].toLowerCase();

  switch (unit) {
    case 's':
      return amount;
    case 'm':
      return amount * 60;
    case 'h':
      return amount * 60 * 60;
    case 'd':
      return amount * 60 * 60 * 24;
    default:
      return 60 * 60 * 24 * 7;
  }
}

class RefreshTokenStoreService {
  private readonly activeTokenMemory = new Map<string, string>();
  private readonly revokedTokenMemory = new Set<string>();
  private readonly refreshTtlSeconds = parseDurationToSeconds(env.JWT_REFRESH_EXPIRY);

  private getActiveKey(userId: string): string {
    return `auth:refresh:active:${userId}`;
  }

  private getRevokedKey(jti: string): string {
    return `auth:refresh:revoked:${jti}`;
  }

  async setActiveJtiForUser(userId: string, jti: string): Promise<void> {
    this.activeTokenMemory.set(userId, jti);
    await cacheService.set(this.getActiveKey(userId), jti, this.refreshTtlSeconds);
  }

  async getActiveJtiForUser(userId: string): Promise<string | null> {
    const cached = await cacheService.get<string>(this.getActiveKey(userId));
    if (cached) {
      this.activeTokenMemory.set(userId, cached);
      return cached;
    }

    return this.activeTokenMemory.get(userId) || null;
  }

  async revokeJti(jti: string): Promise<void> {
    this.revokedTokenMemory.add(jti);
    await cacheService.set(this.getRevokedKey(jti), true, this.refreshTtlSeconds);
  }

  async isJtiRevoked(jti: string): Promise<boolean> {
    const cached = await cacheService.get<boolean>(this.getRevokedKey(jti));
    if (cached === true) {
      this.revokedTokenMemory.add(jti);
      return true;
    }

    return this.revokedTokenMemory.has(jti);
  }

  async clearActiveJtiForUser(userId: string): Promise<void> {
    this.activeTokenMemory.delete(userId);
    await cacheService.delete(this.getActiveKey(userId));
  }

  async clearMemoryStateForTests(): Promise<void> {
    if (env.NODE_ENV !== 'test') {
      return;
    }

    this.activeTokenMemory.clear();
    this.revokedTokenMemory.clear();
  }
}

export const refreshTokenStoreService = new RefreshTokenStoreService();
