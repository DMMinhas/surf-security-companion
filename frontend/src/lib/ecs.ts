/**
 * ECS + surf.* field reference used by the Investigate page for field
 * autocomplete and human-readable labels. Kept in sync with
 * docs/DATA_MODEL.md.
 */
export interface FieldInfo {
  field: string;
  label: string;
  type: 'keyword' | 'text' | 'ip' | 'date' | 'boolean' | 'float';
}

export const SURF_FIELDS: FieldInfo[] = [
  { field: '@timestamp', label: 'Timestamp', type: 'date' },
  { field: 'event.action', label: 'Event action', type: 'keyword' },
  { field: 'event.outcome', label: 'Event outcome', type: 'keyword' },
  { field: 'observer.product', label: 'Source system', type: 'keyword' },
  { field: 'user.name', label: 'User', type: 'keyword' },
  { field: 'source.ip', label: 'Source IP', type: 'ip' },
  { field: 'host.name', label: 'Host', type: 'keyword' },
  { field: 'surf.tenant.id', label: 'Tenant', type: 'keyword' },
  { field: 'surf.tenant.name', label: 'Tenant name', type: 'keyword' },
  { field: 'surf.command.id', label: 'Command ID', type: 'keyword' },
  { field: 'surf.command.type', label: 'Command type', type: 'keyword' },
  { field: 'surf.command.signed', label: 'Command signed', type: 'boolean' },
  { field: 'surf.command.magnitude_kw', label: 'Magnitude (kW)', type: 'float' },
  { field: 'surf.grid.section', label: 'Grid section', type: 'keyword' },
  { field: 'surf.ems.id', label: 'EMS device', type: 'keyword' },
  { field: 'surf.ems.firmware_version', label: 'EMS firmware', type: 'keyword' },
  { field: 'surf.prosumer.pseudonym', label: 'Prosumer (pseudonym)', type: 'keyword' },
  { field: 'surf.trade.cycle_id', label: 'Trading cycle', type: 'keyword' },
  { field: 'surf.risk.tier', label: 'Risk tier', type: 'keyword' },
];

export const PIVOT_FIELDS = [
  'source.ip',
  'user.name',
  'host.name',
  'surf.tenant.id',
  'surf.ems.id',
  'surf.command.id',
  'surf.grid.section',
  'surf.trade.cycle_id',
  'surf.prosumer.pseudonym',
] as const;
