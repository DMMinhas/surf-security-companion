import * as Minio from 'minio';
import type { AppConfig } from '../../config.js';
import type { BlobStore } from '../../../domain/ports/connectors.js';
import { withSpan } from '../../telemetry/otel.js';

/**
 * MinIO adapter. Buckets are created with Object Lock (Compliance mode) by
 * the setup-minio sidecar; `putWorm` additionally stamps a per-object
 * retention date so each object is immutable for the configured period.
 */
export class MinioBlobStore implements BlobStore {
  private readonly client: Minio.Client;
  private readonly retentionYears: number;

  constructor(config: AppConfig) {
    const [host, portRaw] = config.minio.endpoint.split(':');
    this.client = new Minio.Client({
      endPoint: host ?? 'minio',
      port: portRaw ? Number(portRaw) : 9000,
      useSSL: config.minio.useSsl,
      accessKey: config.minio.accessKey,
      secretKey: config.minio.secretKey,
    });
    this.retentionYears = config.minio.objectLockYears;
  }

  async putWorm(bucket: string, key: string, body: Buffer, contentType: string): Promise<{ etag: string }> {
    return withSpan('minio.putWorm', { bucket, key }, async () => {
      const retainUntil = new Date();
      retainUntil.setUTCFullYear(retainUntil.getUTCFullYear() + this.retentionYears);
      const result = await this.client.putObject(bucket, key, body, body.length, {
        'Content-Type': contentType,
        'X-Amz-Object-Lock-Mode': 'COMPLIANCE',
        'X-Amz-Object-Lock-Retain-Until-Date': retainUntil.toISOString(),
      });
      return { etag: result.etag };
    });
  }

  async presignedGetUrl(bucket: string, key: string, expirySeconds: number): Promise<string> {
    return this.client.presignedGetObject(bucket, key, expirySeconds);
  }

  async get(bucket: string, key: string): Promise<Buffer> {
    return withSpan('minio.get', { bucket, key }, async () => {
      const stream = await this.client.getObject(bucket, key);
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(chunk as Buffer);
      return Buffer.concat(chunks);
    });
  }

  async exists(bucket: string, key: string): Promise<boolean> {
    try {
      await this.client.statObject(bucket, key);
      return true;
    } catch {
      return false;
    }
  }
}
