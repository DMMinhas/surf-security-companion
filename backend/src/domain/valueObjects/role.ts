export const ROLES = [
  'SOC_ANALYST',
  'DSO_OPERATOR',
  'PLATFORM_ADMIN',
  'AUDITOR',
  'EXECUTIVE_OBSERVER',
] as const;
export type Role = (typeof ROLES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

/** Roles that see all tenants; everyone else is scoped to their surf_tenant_id claim. */
export const CROSS_TENANT_ROLES: readonly Role[] = ['PLATFORM_ADMIN', 'AUDITOR', 'SOC_ANALYST'];

/** Roles that may never mutate anything. */
export const READ_ONLY_ROLES: readonly Role[] = ['AUDITOR', 'EXECUTIVE_OBSERVER'];

export function isCrossTenant(roles: readonly Role[]): boolean {
  return roles.some((r) => CROSS_TENANT_ROLES.includes(r));
}
