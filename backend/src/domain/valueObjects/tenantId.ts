/**
 * Tenant identifier value object.
 *
 * Tenant ids are short kebab-case slugs issued by the platform team
 * (e.g. `vnb-saar`). The format is enforced here once so every layer
 * can trust a validated TenantId.
 */
const TENANT_ID_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const MAX_LENGTH = 64;

export class InvalidTenantIdError extends Error {
  constructor(raw: string) {
    super(`Invalid tenant id: ${JSON.stringify(raw)}`);
    this.name = 'InvalidTenantIdError';
  }
}

export class TenantId {
  private constructor(public readonly value: string) {}

  static parse(raw: string): TenantId {
    if (raw.length === 0 || raw.length > MAX_LENGTH || !TENANT_ID_PATTERN.test(raw)) {
      throw new InvalidTenantIdError(raw);
    }
    return new TenantId(raw);
  }

  static tryParse(raw: unknown): TenantId | undefined {
    if (typeof raw !== 'string') return undefined;
    try {
      return TenantId.parse(raw);
    } catch {
      return undefined;
    }
  }

  equals(other: TenantId): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
