/**
 * Default reference-data adapters for the enrichment engine.
 *
 * Two of the six ports are stateful — login history and firmware inventory grow
 * as events flow through. They expose `observe(event)` so the ingest path can
 * feed the stream in timestamp order; the rest are static lookups sourced from
 * config (IP geo table, IP allow-list, change-window calendar, tenant directory).
 *
 * The seeded defaults mirror the demo topology (VNB Saar / Pfalz) so the stack
 * detects the same 15 scenarios from *raw* events, with no pre-baked flags.
 */
import { getField } from './evaluator.js';
import type {
  ChangeWindowCalendar,
  EnrichmentRefs,
  Event,
  FirmwareInventory,
  GeoPoint,
  GeoResolver,
  IpAllowlist,
  LoginHistory,
  TenantDirectory,
} from './enrichment.js';
import { compareSemver } from './enrichment.js';

export interface GeoEntry extends GeoPoint {
  label?: string;
}

export interface ChangeWindow {
  /** ISO-8601 start / end of the declared maintenance window (inclusive/exclusive). */
  startIso: string;
  endIso: string;
}

export interface ReferenceConfig {
  geo: Record<string, GeoEntry>;
  allowlistCidrs: string[];
  changeWindows: ChangeWindow[];
  tenantByUser: Record<string, string>;
  firmwareBaseline: Record<string, string>;
}

// ---------------------------------------------------------------- geo
class TableGeoResolver implements GeoResolver {
  constructor(private readonly table: Record<string, GeoEntry>) {}
  locate(ip: string): GeoPoint | undefined {
    const e = this.table[ip];
    return e ? { lat: e.lat, lon: e.lon } : undefined;
  }
}

// ---------------------------------------------------------------- allow-list (IPv4 CIDR)
function ipv4ToInt(ip: string): number | undefined {
  const octets = ip.split('.');
  if (octets.length !== 4) return undefined;
  let acc = 0;
  for (const octet of octets) {
    const n = Number.parseInt(octet, 10);
    if (Number.isNaN(n) || n < 0 || n > 255) return undefined;
    acc = acc * 256 + n;
  }
  return acc >>> 0;
}

class CidrAllowlist implements IpAllowlist {
  private readonly ranges: Array<{ base: number; mask: number }> = [];
  constructor(cidrs: string[]) {
    for (const cidr of cidrs) {
      const [addr, bitsRaw] = cidr.split('/');
      const bits = bitsRaw === undefined ? 32 : Number.parseInt(bitsRaw, 10);
      const base = addr !== undefined ? ipv4ToInt(addr) : undefined;
      if (base === undefined || Number.isNaN(bits) || bits < 0 || bits > 32) continue;
      const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
      this.ranges.push({ base: (base & mask) >>> 0, mask });
    }
  }
  allows(ip: string): boolean {
    const addr = ipv4ToInt(ip);
    if (addr === undefined) return false;
    return this.ranges.some((r) => ((addr & r.mask) >>> 0) === r.base);
  }
}

// ---------------------------------------------------------------- change window
class WindowCalendar implements ChangeWindowCalendar {
  constructor(private readonly windows: ChangeWindow[]) {}
  isOpen(atIso: string): boolean {
    const t = Date.parse(atIso);
    if (Number.isNaN(t)) return false;
    return this.windows.some((w) => t >= Date.parse(w.startIso) && t < Date.parse(w.endIso));
  }
}

// ---------------------------------------------------------------- tenant directory
class MapTenantDirectory implements TenantDirectory {
  constructor(private readonly byUser: Record<string, string>) {}
  homeTenant(user: string): string | undefined {
    return this.byUser[user];
  }
}

// ---------------------------------------------------------------- firmware inventory (stateful)
export class InMemoryFirmwareInventory implements FirmwareInventory {
  private readonly latest = new Map<string, string>();
  constructor(baseline: Record<string, string> = {}) {
    for (const [ems, version] of Object.entries(baseline)) this.latest.set(ems, version);
  }
  lastVersion(emsId: string): string | undefined {
    return this.latest.get(emsId);
  }
  /** Advance the baseline only on an upgrade, so a rollback stays detectable. */
  record(emsId: string, version: string): void {
    const current = this.latest.get(emsId);
    if (current === undefined || compareSemver(version, current) > 0) this.latest.set(emsId, version);
  }
}

// ---------------------------------------------------------------- login history (stateful)
export class InMemoryLoginHistory implements LoginHistory {
  private readonly byUser = new Map<string, Array<{ ts: string; ip: string }>>();
  private readonly cap = 50;

  recentSuccessfulLogins(user: string, beforeIso: string, windowMs: number): Array<{ ts: string; ip: string }> {
    const before = Date.parse(beforeIso);
    const cutoff = before - windowMs;
    return (this.byUser.get(user) ?? []).filter((l) => {
      const t = Date.parse(l.ts);
      return t < before && t >= cutoff;
    });
  }
  record(user: string, ts: string, ip: string): void {
    const list = this.byUser.get(user) ?? [];
    list.push({ ts, ip });
    if (list.length > this.cap) list.shift();
    this.byUser.set(user, list);
  }
}

/**
 * Bundles the six reference ports and feeds the two stateful ones from the
 * event stream. Call `observe(event)` for every event *before* enriching it, in
 * timestamp order, so history/inventory reflect what was known at that instant.
 */
export class DefaultReferenceData implements EnrichmentRefs {
  readonly geo: GeoResolver;
  readonly allowlist: IpAllowlist;
  readonly changeWindow: ChangeWindowCalendar;
  readonly tenants: TenantDirectory;
  readonly firmware: InMemoryFirmwareInventory;
  readonly logins: InMemoryLoginHistory;

  constructor(config: ReferenceConfig) {
    this.geo = new TableGeoResolver(config.geo);
    this.allowlist = new CidrAllowlist(config.allowlistCidrs);
    this.changeWindow = new WindowCalendar(config.changeWindows);
    this.tenants = new MapTenantDirectory(config.tenantByUser);
    this.firmware = new InMemoryFirmwareInventory(config.firmwareBaseline);
    this.logins = new InMemoryLoginHistory();
  }

  observe(event: Event): void {
    const action = str(getField(event, 'event.action'));
    if (action === 'LOGIN' && str(getField(event, 'event.outcome')) === 'success') {
      const user = str(getField(event, 'user.name'));
      const ip = str(getField(event, 'source.ip'));
      const ts = str(getField(event, '@timestamp'));
      if (user && ip && ts) this.logins.record(user, ts, ip);
    } else if (action === 'firmware_inventory') {
      const ems = str(getField(event, 'surf.ems.id'));
      const version = str(getField(event, 'surf.ems.firmware_version'));
      if (ems && version) this.firmware.record(ems, version);
    }
  }
}

function str(v: unknown): string | undefined {
  return v === undefined || v === null ? undefined : String(v);
}

/**
 * Reference data seeded to the demo topology. Real deployments supply these
 * from source-of-truth systems (IPAM/geo feed, CMDB firmware inventory, the
 * change calendar, and the tenant directory in Keycloak).
 */
export const DEMO_REFERENCE_CONFIG: ReferenceConfig = {
  geo: {
    '203.0.113.66': { lat: 49.24, lon: 6.99, label: 'Saarbrücken' },
    '203.0.113.77': { lat: 49.44, lon: 7.77, label: 'Kaiserslautern' },
    '198.51.100.7': { lat: 50.11, lon: 8.68, label: 'Frankfurt' },
    // second leg of the R-02 impossible-travel pair — ~9000 km from Frankfurt
    '203.0.113.5': { lat: 1.35, lon: 103.82, label: 'Singapore' },
  },
  allowlistCidrs: ['10.0.0.0/8', '192.168.0.0/16'],
  // Firmware baseline predates the seed's rollback report (ems-0815 was on 2.4.0).
  firmwareBaseline: { 'ems-0815': '2.4.0', 'ems-4711': '3.0.1' },
  // A single declared window well away from the seed's off-window account creation.
  changeWindows: [{ startIso: '2026-07-01T22:00:00Z', endIso: '2026-07-01T23:59:00Z' }],
  tenantByUser: {
    app_vnb_saar: 'vnb-saar',
    app_vnb_pfalz: 'vnb-pfalz',
    'dirk.dso': 'vnb-saar',
    soc_app: 'vnb-saar',
  },
};
