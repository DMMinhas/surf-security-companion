import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Case, Nis2ReportKind } from '../../domain/entities/case.js';
import { nis2Deadline } from '../../domain/entities/case.js';
import type { CaseRepository } from '../../domain/ports/repositories.js';
import type { BlobStore } from '../../domain/ports/connectors.js';
import type { CallerContext } from '../context.js';
import type { AuditService } from '../audit/auditService.js';
import { NotFoundError, StepUpRequiredError, ValidationError } from '../errors.js';
import type { Logger } from 'pino';

const require = createRequire(import.meta.url);
// docxtemplater + pizzip are CJS; loaded lazily so unit tests can stub rendering.
type DocxRenderer = (templateBuf: Buffer, data: Record<string, unknown>) => Buffer;

export const NIS2_KIND_BY_ROUTE: Record<string, Nis2ReportKind> = {
  'early-warning': '24h',
  incident: '72h',
  final: '1m',
};

const TEMPLATE_FILES: Record<Nis2ReportKind, string> = {
  '24h': 'early_warning.docx',
  '72h': 'incident_report.docx',
  '1m': 'final_report.docx',
};

export interface Nis2Config {
  auditBucket: string;
  templatesDir: string;
  presignExpirySeconds: number;
  requireStepUp: boolean;
}

export interface Nis2ReportResult {
  caseId: string;
  kind: Nis2ReportKind;
  url: string;
  hash: string;
  deadline: string;
  generatedAt: string;
}

export class Nis2Service {
  constructor(
    private readonly cases: CaseRepository,
    private readonly blobs: BlobStore,
    private readonly audit: AuditService,
    private readonly config: Nis2Config,
    private readonly log: Logger,
    private readonly renderDocx: DocxRenderer = defaultDocxRenderer,
  ) {}

  async generate(caller: CallerContext, caseId: string, kind: Nis2ReportKind): Promise<Nis2ReportResult> {
    if (this.config.requireStepUp && !caller.mfaVerified) throw new StepUpRequiredError();

    const kase = await this.cases.getById(caseId, caller.tenantId);
    if (!kase) throw new NotFoundError('Case', caseId);
    if (!kase.significantIncidentAt && kind !== '24h') {
      throw new ValidationError(
        'Case is not classified as a significant incident; generate the early warning (24h) first or classify the case',
      );
    }

    const generatedAt = new Date().toISOString();
    const classifiedAt = kase.significantIncidentAt ?? generatedAt;
    const deadline = nis2Deadline(classifiedAt, kind).toISOString();

    const templatePath = path.join(this.config.templatesDir, TEMPLATE_FILES[kind]);
    const template = await readFile(templatePath);
    const docx = this.renderDocx(template, this.templateData(kase, kind, generatedAt, deadline));

    const hash = createHash('sha256').update(docx).digest('hex');
    const key = `nis2/${caseId}/${kind}-${generatedAt.replaceAll(':', '-')}.docx`;
    await this.blobs.putWorm(
      this.config.auditBucket,
      key,
      docx,
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    const url = await this.blobs.presignedGetUrl(this.config.auditBucket, key, this.config.presignExpirySeconds);

    await this.cases.addNis2Report(caseId, { kind, ts: generatedAt, url: key, hash });
    await this.audit.record(caller, {
      action: `report.nis2.${kind}`,
      resourceType: 'case',
      resourceId: caseId,
      outcome: 'success',
      details: { key, hash, deadline },
    });
    this.log.info({ caseId, kind, hash }, 'NIS2 report generated and WORM-stored');
    return { caseId, kind, url, hash, deadline, generatedAt };
  }

  private templateData(kase: Case, kind: Nis2ReportKind, generatedAt: string, deadline: string) {
    return {
      report_kind: kind,
      generated_at: generatedAt,
      deadline,
      case_id: kase.id,
      case_title: kase.title,
      case_description: kase.description,
      severity: kase.severity,
      tenant: kase.tenantId ?? 'platform-wide',
      status: kase.status,
      classified_at: kase.significantIncidentAt ?? 'not classified',
      attack_techniques: kase.attackTechniques.join(', ') || 'none mapped',
      alert_count: kase.alerts.length,
      actions: kase.actions.map((a) => ({
        ts: a.ts,
        actor: a.actor,
        action: a.action,
        outcome: a.outcome,
        notes: a.notes ?? '',
      })),
      cross_border_impact: 'to be assessed by the reporting officer',
      contact: 'soc@surf-project.example',
    };
  }
}

function defaultDocxRenderer(templateBuf: Buffer, data: Record<string, unknown>): Buffer {
  const PizZip = require('pizzip') as new (b: Buffer) => unknown;
  const Docxtemplater = require('docxtemplater') as new (
    zip: unknown,
    opts: Record<string, unknown>,
  ) => { render(d: Record<string, unknown>): void; getZip(): { generate(o: { type: 'nodebuffer' }): Buffer } };
  const doc = new Docxtemplater(new PizZip(templateBuf), { paragraphLoop: true, linebreaks: true });
  doc.render(data);
  return doc.getZip().generate({ type: 'nodebuffer' });
}
