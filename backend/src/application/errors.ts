/** Typed application errors; the HTTP error middleware maps these to status codes. */

export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly httpStatus: number,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id: string) {
    super(`${resource} ${id} not found`, 'NOT_FOUND', 404, { resource, id });
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden', details?: Record<string, unknown>) {
    super(message, 'FORBIDDEN', 403, details);
  }
}

export class StepUpRequiredError extends AppError {
  constructor() {
    super('Step-up MFA (acr >= mfa) required for this action', 'STEP_UP_REQUIRED', 403, {
      remediation: 'Re-authenticate with WebAuthn/OTP to obtain an mfa-level token',
    });
  }
}

export class InvalidTransitionError extends AppError {
  constructor(entity: string, from: string, to: string) {
    super(`Illegal ${entity} transition ${from} -> ${to}`, 'INVALID_TRANSITION', 409, { entity, from, to });
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'VALIDATION_ERROR', 400, details);
  }
}

export class ApprovalRequiredError extends AppError {
  constructor(runId: string, targetCount: number, threshold: number) {
    super(
      `Mass action (${targetCount} targets > threshold ${threshold}) requires four-eyes approval`,
      'APPROVAL_REQUIRED',
      202,
      { runId, targetCount, threshold },
    );
  }
}

export class UpstreamError extends AppError {
  constructor(system: string, cause: string) {
    super(`Upstream ${system} failed: ${cause}`, 'UPSTREAM_ERROR', 502, { system });
  }
}
