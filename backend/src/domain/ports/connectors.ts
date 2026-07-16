/** Outbound integration ports. Implementations live in infrastructure/integrations. */

export interface TokenRevocation {
  tokenId: string;
  userId?: string;
  /** State captured before revocation so a token can be manually re-issued. */
  priorState: Record<string, unknown>;
}

export interface KeycloakConnector {
  revokeToken(tokenId: string, dryRun: boolean): Promise<TokenRevocation>;
  listSessions(userId: string): Promise<Array<Record<string, unknown>>>;
}

export interface EmsQuarantineResult {
  emsId: string;
  quarantined: boolean;
  reversible: true;
  priorMode: string;
}

export interface EmsConnector {
  quarantine(emsId: string, dryRun: boolean): Promise<EmsQuarantineResult>;
  resetQuarantine(emsId: string, dryRun: boolean): Promise<EmsQuarantineResult>;
  status(emsId: string): Promise<{ emsId: string; mode: string; firmware: string }>;
}

export interface FlexConnector {
  gridSectionInfo(section: string): Promise<Record<string, unknown>>;
}

export interface Pager {
  page(summary: string, severity: 'critical' | 'error' | 'warning' | 'info', details: Record<string, unknown>): Promise<void>;
}

export interface ChatNotifier {
  notify(text: string): Promise<void>;
}

export interface BlobStore {
  putWorm(bucket: string, key: string, body: Buffer, contentType: string): Promise<{ etag: string }>;
  presignedGetUrl(bucket: string, key: string, expirySeconds: number): Promise<string>;
  get(bucket: string, key: string): Promise<Buffer>;
  exists(bucket: string, key: string): Promise<boolean>;
}

export interface WazuhConnector {
  managerStatus(): Promise<{ alive: boolean; version?: string }>;
  reloadRules(): Promise<void>;
}

export interface Signer {
  sign(message: Uint8Array): Promise<Uint8Array>;
  publicKeyHex(): Promise<string>;
  verify(message: Uint8Array, signature: Uint8Array): Promise<boolean>;
}

export interface Clock {
  now(): Date;
}

export interface IdGenerator {
  next(): string;
}
