/**
 * RefreshTokenStoreService
 *
 * Centralises the in-memory state for refresh token rotation so that:
 *  - auth.ts can set/clear the active JTI per user and revoke old JTIs
 *  - tests can inspect / clear the state between test runs
 */

class RefreshTokenStoreService {
  private activeRefreshTokenByUserId = new Map<string, string>();
  private revokedRefreshTokenJti = new Set<string>();

  /** Record the active JTI for a user (overwrites previous value). */
  setActiveJti(userId: string, jti: string): void {
    this.activeRefreshTokenByUserId.set(userId, jti);
  }

  /** Return the currently-active JTI for a user, or undefined. */
  getActiveJtiForUser(userId: string): string | undefined {
    return this.activeRefreshTokenByUserId.get(userId);
  }

  /** Remove the active JTI for a user (e.g. on logout). */
  deleteActiveJti(userId: string): void {
    this.activeRefreshTokenByUserId.delete(userId);
  }

  /** Mark a JTI as revoked. */
  revokeJti(jti: string): void {
    this.revokedRefreshTokenJti.add(jti);
  }

  /** Check whether a JTI has been revoked. */
  isJtiRevoked(jti: string): boolean {
    return this.revokedRefreshTokenJti.has(jti);
  }

  /**
   * Clear all in-memory state.
   * Intended for use in test environments only.
   */
  clearMemoryStateForTests(): void {
    this.activeRefreshTokenByUserId.clear();
    this.revokedRefreshTokenJti.clear();
  }
}

// Singleton – shared by the auth route and tests
export const refreshTokenStoreService = new RefreshTokenStoreService();
