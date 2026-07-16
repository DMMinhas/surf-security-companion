import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AppConfig } from '../../config.js';
import type { CallerContext } from '../../../application/context.js';
import { isRole, type Role } from '../../../domain/valueObjects/role.js';
import { TenantId } from '../../../domain/valueObjects/tenantId.js';

declare module 'fastify' {
  interface FastifyRequest {
    caller?: CallerContext;
  }
}

/** ACR values that count as step-up MFA (Keycloak level-of-authentication). */
const MFA_ACR_VALUES = new Set(['mfa', 'urn:keycloak:loa:2', '2']);

export class AuthzMiddleware {
  private readonly jwks: ReturnType<typeof createRemoteJWKSet>;

  constructor(private readonly config: AppConfig) {
    this.jwks = createRemoteJWKSet(new URL(config.oidc.jwksUri));
  }

  /**
   * Returns a Fastify preHandler enforcing: valid JWT (iss/aud/exp/nbf via
   * jose), role allow-list, and caller-context construction. Cross-tenant
   * roles skip tenant binding; everyone else gets req.caller.tenantId from
   * the surf_tenant_id claim.
   */
  require(allowedRoles: readonly Role[]) {
    return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
      const header = req.headers.authorization;
      if (!header?.startsWith('Bearer ')) {
        await reply.code(401).send({ code: 'UNAUTHENTICATED', message: 'Missing bearer token' });
        return;
      }
      let payload: JWTPayload;
      try {
        const result = await jwtVerify(header.slice(7), this.jwks, {
          issuer: this.config.oidc.issuerUrl,
          audience: this.config.oidc.audience,
        });
        payload = result.payload;
      } catch (err) {
        req.log.warn({ err: err instanceof Error ? err.message : String(err) }, 'jwt verification failed');
        await reply.code(401).send({ code: 'UNAUTHENTICATED', message: 'Invalid token' });
        return;
      }

      const roles = extractRoles(payload);
      if (!roles.some((r) => allowedRoles.includes(r))) {
        req.log.warn({ user: payload.preferred_username, roles, needed: allowedRoles }, 'role denied');
        await reply.code(403).send({ code: 'FORBIDDEN', message: 'Insufficient role' });
        return;
      }

      const rawTenant = payload[this.config.oidc.tenantClaim];
      const tenant = TenantId.tryParse(rawTenant);
      const crossTenant = roles.some((r) => r === 'PLATFORM_ADMIN' || r === 'AUDITOR' || r === 'SOC_ANALYST');
      if (!crossTenant && tenant === undefined) {
        await reply.code(403).send({ code: 'FORBIDDEN', message: 'Token lacks a valid tenant claim' });
        return;
      }

      const acr = typeof payload['acr'] === 'string' ? payload['acr'] : '';
      const caller: CallerContext = {
        userId: String(payload.sub ?? ''),
        username: String(payload['preferred_username'] ?? payload.sub ?? 'unknown'),
        roles,
        ...(crossTenant ? {} : { tenantId: tenant?.value }),
        requestId: String(req.id),
        mfaVerified: MFA_ACR_VALUES.has(acr),
      };
      req.caller = caller;

      req.log.info(
        {
          user: caller.username,
          roles,
          tenant: caller.tenantId,
          action: `${req.method} ${req.routeOptions?.url ?? req.url}`,
          requestId: caller.requestId,
        },
        'authorized request',
      );
    };
  }
}

function extractRoles(payload: JWTPayload): Role[] {
  const realmAccess = payload['realm_access'];
  const raw =
    realmAccess && typeof realmAccess === 'object' && 'roles' in realmAccess
      ? (realmAccess as { roles: unknown }).roles
      : payload['roles'];
  if (!Array.isArray(raw)) return [];
  return raw.filter(isRole);
}
