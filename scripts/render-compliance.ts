/** Renders backend/src/compliance/controlsMatrix.json into COMPLIANCE.md. */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

interface Control {
  id: string;
  title: string;
  nis2: string;
  iec62443: string;
  kritis: string;
  iso27001: string;
}

const matrixPath = path.join(process.cwd(), 'backend', 'src', 'compliance', 'controlsMatrix.json');
const matrix = JSON.parse(readFileSync(matrixPath, 'utf8')) as { generated: string; controls: Control[] };

const rows = matrix.controls
  .map((c) => `| ${c.id} | ${c.title} | ${c.nis2} | ${c.iec62443} | ${c.kritis} | ${c.iso27001} |`)
  .join('\n');

const md = `# Compliance Controls Matrix

<!-- GENERATED from backend/src/compliance/controlsMatrix.json by scripts/render-compliance.ts — do not edit by hand. -->

Generated: ${matrix.generated}

This matrix maps every SURF detection rule (R-\\*) and platform control (P-\\*) to the relevant
obligations under **NIS2 (Directive (EU) 2022/2555)**, **IEC 62443-3-3**, **KRITIS (§8a BSIG)**
and **ISO/IEC 27001:2022 Annex A**.

| Control | Title | NIS2 | IEC 62443-3-3 | KRITIS | ISO 27001 |
|---------|-------|------|---------------|--------|-----------|
${rows}

## Notes

- **NIS2 Art. 21(2)** enumerates the risk-management measures; the letter in parentheses
  identifies the specific measure (e.g. (b) = incident handling, (h) = cryptography).
- **NIS2 Art. 23** governs incident reporting (24h early warning / 72h notification / 1-month
  final report) — implemented by the NIS2 report generator (control P-04).
- **IEC 62443-3-3 FR** = Foundational Requirement (FR1 Identification & Authentication,
  FR2 Use Control, FR3 System Integrity, FR4 Data Confidentiality, FR5 Restricted Data Flow,
  FR7 Resource Availability).
- Cryptographic auditability (P-03, P-06) provides the tamper-evidence required for
  KRITIS evidence retention and NIS2 Art. 21(2)(h).
`;

writeFileSync(path.join(process.cwd(), 'COMPLIANCE.md'), md);
console.log(`rendered COMPLIANCE.md with ${matrix.controls.length} controls`);
