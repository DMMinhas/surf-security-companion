import type { Role } from '../domain/valueObjects/role.js';

/**
 * Authenticated caller context, built by the authz middleware and passed
 * into every application service call. `tenantId` is undefined for
 * cross-tenant roles (PLATFORM_ADMIN, AUDITOR, SOC_ANALYST).
 */
export interface CallerContext {
  userId: string;
  username: string;
  roles: Role[];
  tenantId?: string;
  requestId: string;
  /** True when the access token carries an MFA-level acr claim (step-up). */
  mfaVerified: boolean;
}
