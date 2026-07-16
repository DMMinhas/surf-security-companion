import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { AppError } from '../../../application/errors.js';

/**
 * Central error mapper: typed AppErrors keep their status/code; Zod issues
 * become 400s with field detail; everything else is a sanitised 500 (no
 * stack traces or internals leave the process).
 */
export function errorHandler(error: FastifyError | Error, req: FastifyRequest, reply: FastifyReply): void {
  if (error instanceof AppError) {
    void reply.code(error.httpStatus).send({
      code: error.code,
      message: error.message,
      details: error.details,
      requestId: req.id,
    });
    return;
  }
  if (error instanceof ZodError) {
    void reply.code(400).send({
      code: 'VALIDATION_ERROR',
      message: 'Request validation failed',
      details: { issues: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) },
      requestId: req.id,
    });
    return;
  }
  const fastifyStatus = 'statusCode' in error && typeof error.statusCode === 'number' ? error.statusCode : 500;
  if (fastifyStatus >= 500) {
    req.log.error({ err: error }, 'unhandled error');
    void reply.code(500).send({ code: 'INTERNAL', message: 'Internal server error', requestId: req.id });
    return;
  }
  void reply.code(fastifyStatus).send({ code: 'REQUEST_ERROR', message: error.message, requestId: req.id });
}
