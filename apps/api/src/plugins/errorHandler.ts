import type { ErrorResponse } from '@myreport/shared-schemas';
import type { FastifyError, FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';

const errorHandlerPlugin: FastifyPluginAsync = async (app) => {
  app.setErrorHandler((err: FastifyError, request, reply) => {
    const status =
      typeof err.statusCode === 'number' && err.statusCode >= 400 && err.statusCode < 600
        ? err.statusCode
        : 500;

    if (status >= 500) {
      request.log.error({ err }, 'unhandled error');
    }

    const body: ErrorResponse = {
      code: err.code ?? defaultCodeFor(status),
      message: err.message || 'internal error',
    };
    return reply.code(status).send(body);
  });
};

function defaultCodeFor(status: number): string {
  if (status === 400) return 'BAD_REQUEST';
  if (status === 401) return 'UNAUTHORIZED';
  if (status === 403) return 'FORBIDDEN';
  if (status === 404) return 'NOT_FOUND';
  if (status === 409) return 'CONFLICT';
  if (status === 422) return 'UNPROCESSABLE_ENTITY';
  if (status === 429) return 'TOO_MANY_REQUESTS';
  return 'INTERNAL_ERROR';
}

export default fp(errorHandlerPlugin, { name: 'errorHandler' });
