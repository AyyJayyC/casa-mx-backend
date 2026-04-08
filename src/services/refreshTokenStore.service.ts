/**
 * Refresh Token Store Service
 * Manages active refresh token JTIs and revoked JTI tracking for JWT rotation.
 *
 * - activeRefreshTokenByUserId: maps userId -> latest active refresh JTI
 * - revokedRefreshTokenJti: set of revoked JTIs (prevents replay attacks)
 *
 * In production, these would be backed by Redis for multi-instance support.
 * For now, in-memory storage is used with graceful test helpers.
 */

export class RefreshTokenStoreService {
  private activeRefreshTokenByUserId = new Map<string, string>();
  private revokedRefreshTokenJti = new Set<string>();

  /**
   * Store the active refresh token JTI for a user.
   * Replaces any previously stored JTI for that user.
   */
  setActiveJtiForUser(userId: string, jti: string): void {
    this.activeRefreshTokenByUserId.set(userId, jti);
  }

  /**
   * Get the currently active refresh token JTI for a user.
   * Returns undefined if no active JTI is stored.
   */
  getActiveJtiForUser(userId: string): string | undefined {
    return this.activeRefreshTokenByUserId.get(userId);
  }

  /**
   * Remove the active refresh token JTI for a user (e.g., on logout).
   */
  deleteActiveJtiForUser(userId: string): void {
    this.activeRefreshTokenByUserId.delete(userId);
  }

  /**
   * Mark a JTI as revoked so it cannot be reused.
   */
  revokeJti(jti: string): void {
    this.revokedRefreshTokenJti.add(jti);
  }

  /**
   * Check whether a given JTI has been revoked.
   */
  isJtiRevoked(jti: string): boolean {
    return this.revokedRefreshTokenJti.has(jti);
  }

  /**
   * Clear all in-memory state. Only intended for use in tests.
   */
  clearMemoryStateForTests(): void {
    this.activeRefreshTokenByUserId.clear();
    this.revokedRefreshTokenJti.clear();
  }
}

export const refreshTokenStoreService = new RefreshTokenStoreService();
