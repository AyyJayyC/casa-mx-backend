/**
 * RefreshTokenStore Service
 *
 * Manages refresh token JTI state in memory.
 * Tracks which JTI is active per user and which JTIs have been revoked.
 * In production this could be backed by Redis for horizontal scaling.
 */

class RefreshTokenStoreService {
  private activeJtiByUserId = new Map<string, string>();
  private revokedJtis = new Set<string>();

  /**
   * Store the active JTI for a user (replaces any previously stored JTI).
   */
  setActiveJtiForUser(userId: string, jti: string): void {
    this.activeJtiByUserId.set(userId, jti);
  }

  /**
   * Retrieve the currently active JTI for a user, or null if none exists.
   */
  getActiveJtiForUser(userId: string): string | null {
    return this.activeJtiByUserId.get(userId) ?? null;
  }

  /**
   * Mark a JTI as revoked so it can no longer be used.
   */
  revokeJti(jti: string): void {
    this.revokedJtis.add(jti);
  }

  /**
   * Check whether a given JTI has been revoked.
   */
  isJtiRevoked(jti: string): boolean {
    return this.revokedJtis.has(jti);
  }

  /**
   * Remove all token state for a user (e.g. on logout).
   */
  deleteUser(userId: string): void {
    this.activeJtiByUserId.delete(userId);
  }

  /**
   * Clear all in-memory state. Only intended for use in tests.
   */
  clearMemoryStateForTests(): void {
    this.activeJtiByUserId.clear();
    this.revokedJtis.clear();
  }
}

export const refreshTokenStoreService = new RefreshTokenStoreService();
