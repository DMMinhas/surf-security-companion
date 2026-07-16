import { UserManager, WebStorageStateStore, User, Log } from 'oidc-client-ts';

/**
 * Keycloak OIDC with Authorization Code + PKCE (S256).
 * Access tokens live in memory only (InMemoryWebStorage); the silent renew
 * iframe refreshes them. No tokens ever touch localStorage.
 */
Log.setLogger(console);
Log.setLevel(Log.WARN);

class InMemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length(): number {
    return this.map.size;
  }
  clear(): void {
    this.map.clear();
  }
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
}

export const userManager = new UserManager({
  authority: import.meta.env.VITE_OIDC_ISSUER_URL,
  client_id: import.meta.env.VITE_OIDC_CLIENT_ID,
  redirect_uri: `${window.location.origin}/auth/callback`,
  post_logout_redirect_uri: window.location.origin,
  response_type: 'code',
  scope: 'openid profile roles',
  automaticSilentRenew: true,
  silent_redirect_uri: `${window.location.origin}/auth/silent-renew.html`,
  userStore: new WebStorageStateStore({ store: new InMemoryStorage() }),
  // sessionStorage only holds the short-lived state/nonce during the redirect dance
  stateStore: new WebStorageStateStore({ store: window.sessionStorage }),
});

export async function login(): Promise<void> {
  await userManager.signinRedirect();
}

/** Step-up: force re-authentication with an MFA acr for privileged actions. */
export async function stepUp(): Promise<void> {
  await userManager.signinRedirect({ acr_values: 'mfa', prompt: 'login' });
}

export async function logout(): Promise<void> {
  await userManager.signoutRedirect();
}

export async function completeLogin(): Promise<User> {
  return userManager.signinRedirectCallback();
}

export async function currentUser(): Promise<User | null> {
  return userManager.getUser();
}

export interface Claims {
  username: string;
  roles: string[];
  tenantId?: string;
  mfaVerified: boolean;
}

export function claimsOf(user: User): Claims {
  const profile = user.profile as Record<string, unknown>;
  const realmAccess = profile['realm_access'] as { roles?: string[] } | undefined;
  const acr = typeof profile['acr'] === 'string' ? profile['acr'] : '';
  return {
    username: String(profile['preferred_username'] ?? 'unknown'),
    roles: realmAccess?.roles?.filter((r) => r === r.toUpperCase()) ?? [],
    tenantId: typeof profile['surf_tenant_id'] === 'string' ? profile['surf_tenant_id'] : undefined,
    mfaVerified: ['mfa', 'urn:keycloak:loa:2', '2'].includes(acr),
  };
}
