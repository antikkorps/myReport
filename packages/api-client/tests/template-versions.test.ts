import { describe, expect, it } from 'vitest';
import { ApiError, createApiClient } from '../src/index.ts';

interface FetchCall {
  url: string;
  init: RequestInit;
}

function makeFetch(response: Response, calls: FetchCall[] = []): typeof fetch {
  return ((url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return Promise.resolve(response);
  }) as unknown as typeof fetch;
}

const TEMPLATE_ID = '550e8400-e29b-41d4-a716-446655440000';
const VERSION_ID = '550e8400-e29b-41d4-a716-446655440010';

const sampleVersion = {
  id: VERSION_ID,
  templateId: TEMPLATE_ID,
  tenantId: '550e8400-e29b-41d4-a716-446655440001',
  version: 1,
  status: 'draft' as const,
  schema: { version: 1, title: 'Sample', sections: [] },
  publishedAt: null,
  publishedByUserId: null,
  createdAt: '2026-05-13T10:00:00.000Z',
  updatedAt: '2026-05-13T10:00:00.000Z',
};

describe('templateVersions api', () => {
  it('POST /templates/:id/versions serialises the schema and returns the row', async () => {
    const calls: FetchCall[] = [];
    const fetchImpl = makeFetch(
      new Response(JSON.stringify(sampleVersion), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      }),
      calls,
    );
    const client = createApiClient({ baseUrl: '/api', fetch: fetchImpl });

    const result = await client.templateVersions.create(TEMPLATE_ID, {
      schema: { version: 1, title: 'Sample', sections: [] },
    });

    expect(result.id).toBe(VERSION_ID);
    const call = calls[0];
    if (!call) throw new Error('expected one fetch call');
    expect(call.url).toBe(`/api/templates/${TEMPLATE_ID}/versions`);
    expect(call.init.method).toBe('POST');
  });

  it('GET /templates/:id/versions encodes the status filter', async () => {
    const calls: FetchCall[] = [];
    const fetchImpl = makeFetch(
      new Response(JSON.stringify({ items: [sampleVersion] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
      calls,
    );
    const client = createApiClient({ baseUrl: '/api', fetch: fetchImpl });

    await client.templateVersions.list(TEMPLATE_ID, { status: 'published' });

    const call = calls[0];
    if (!call) throw new Error('expected one fetch call');
    expect(call.url).toBe(`/api/templates/${TEMPLATE_ID}/versions?status=published`);
  });

  it('GET /templates/:id/versions without query hits the bare path', async () => {
    const calls: FetchCall[] = [];
    const fetchImpl = makeFetch(
      new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
      calls,
    );
    const client = createApiClient({ baseUrl: '/api', fetch: fetchImpl });

    await client.templateVersions.list(TEMPLATE_ID);

    const call = calls[0];
    if (!call) throw new Error('expected one fetch call');
    expect(call.url).toBe(`/api/templates/${TEMPLATE_ID}/versions`);
  });

  it('GET /templates/:id/versions/:vid returns the version', async () => {
    const calls: FetchCall[] = [];
    const fetchImpl = makeFetch(
      new Response(JSON.stringify(sampleVersion), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
      calls,
    );
    const client = createApiClient({ baseUrl: '/api', fetch: fetchImpl });

    const result = await client.templateVersions.get(TEMPLATE_ID, VERSION_ID);

    expect(result.status).toBe('draft');
    const call = calls[0];
    if (!call) throw new Error('expected one fetch call');
    expect(call.url).toBe(`/api/templates/${TEMPLATE_ID}/versions/${VERSION_ID}`);
  });

  it('PATCH /templates/:id/versions/:vid serialises the schema patch', async () => {
    const calls: FetchCall[] = [];
    const fetchImpl = makeFetch(
      new Response(
        JSON.stringify({
          ...sampleVersion,
          schema: { version: 1, title: 'Edited', sections: [] },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
      calls,
    );
    const client = createApiClient({ baseUrl: '/api', fetch: fetchImpl });

    const result = await client.templateVersions.update(TEMPLATE_ID, VERSION_ID, {
      schema: { version: 1, title: 'Edited', sections: [] },
      expectedUpdatedAt: '2026-05-12T10:00:00.000Z',
    });

    expect(result.schema).toEqual({ version: 1, title: 'Edited', sections: [] });
    const call = calls[0];
    if (!call) throw new Error('expected one fetch call');
    expect(call.init.method).toBe('PATCH');
    expect(JSON.parse(call.init.body as string).expectedUpdatedAt).toBe('2026-05-12T10:00:00.000Z');
  });

  it('POST publish/archive/promote hit their respective sub-paths', async () => {
    for (const verb of ['publish', 'archive', 'promote'] as const) {
      const calls: FetchCall[] = [];
      const fetchImpl = makeFetch(
        new Response(
          JSON.stringify({
            ...sampleVersion,
            status:
              verb === 'publish' ? 'published' : verb === 'archive' ? 'archived' : 'published',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
        calls,
      );
      const client = createApiClient({ baseUrl: '/api', fetch: fetchImpl });

      await client.templateVersions[verb](TEMPLATE_ID, VERSION_ID);

      const call = calls[0];
      if (!call) throw new Error('expected one fetch call');
      expect(call.url).toBe(`/api/templates/${TEMPLATE_ID}/versions/${VERSION_ID}/${verb}`);
      expect(call.init.method).toBe('POST');
    }
  });

  it('DELETE /templates/:id/versions/:vid resolves on 204', async () => {
    const calls: FetchCall[] = [];
    const fetchImpl = makeFetch(new Response(null, { status: 204 }), calls);
    const client = createApiClient({ baseUrl: '/api', fetch: fetchImpl });

    await expect(client.templateVersions.remove(TEMPLATE_ID, VERSION_ID)).resolves.toBeUndefined();

    const call = calls[0];
    if (!call) throw new Error('expected one fetch call');
    expect(call.init.method).toBe('DELETE');
  });

  it('surfaces ApiError on 409 VERSION_NOT_DRAFT (PATCH)', async () => {
    const fetchImpl = makeFetch(
      new Response(JSON.stringify({ code: 'VERSION_NOT_DRAFT', message: 'version is published' }), {
        status: 409,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const client = createApiClient({ baseUrl: '/api', fetch: fetchImpl });

    try {
      await client.templateVersions.update(TEMPLATE_ID, VERSION_ID, {
        schema: { version: 1, title: 'X', sections: [] },
        expectedUpdatedAt: '2026-05-12T10:00:00.000Z',
      });
      throw new Error('expected reject');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).code).toBe('VERSION_NOT_DRAFT');
    }
  });

  it('surfaces ApiError on 409 STALE_VERSION with currentUpdatedAt + currentSchema details', async () => {
    const currentSchema = { version: 1, title: 'Server-side', sections: [] };
    const currentUpdatedAt = '2026-05-13T15:30:00.000Z';
    const fetchImpl = makeFetch(
      new Response(
        JSON.stringify({
          code: 'STALE_VERSION',
          message: 'version was modified since it was loaded',
          details: { currentUpdatedAt, currentSchema },
        }),
        { status: 409, headers: { 'content-type': 'application/json' } },
      ),
    );
    const client = createApiClient({ baseUrl: '/api', fetch: fetchImpl });

    try {
      await client.templateVersions.update(TEMPLATE_ID, VERSION_ID, {
        schema: { version: 1, title: 'Local', sections: [] },
        expectedUpdatedAt: '2026-05-13T15:00:00.000Z',
      });
      throw new Error('expected reject');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      const apiErr = err as ApiError;
      expect(apiErr.code).toBe('STALE_VERSION');
      expect(apiErr.details).toEqual({ currentUpdatedAt, currentSchema });
    }
  });

  it('surfaces ApiError on 409 VERSION_NOT_PUBLISHED (promote)', async () => {
    const fetchImpl = makeFetch(
      new Response(JSON.stringify({ code: 'VERSION_NOT_PUBLISHED', message: 'version is draft' }), {
        status: 409,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const client = createApiClient({ baseUrl: '/api', fetch: fetchImpl });

    try {
      await client.templateVersions.promote(TEMPLATE_ID, VERSION_ID);
      throw new Error('expected reject');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).code).toBe('VERSION_NOT_PUBLISHED');
    }
  });

  it('surfaces ApiError with the SCHEMA_INVALID issues envelope (POST)', async () => {
    const fetchImpl = makeFetch(
      new Response(
        JSON.stringify({
          code: 'SCHEMA_INVALID',
          message: 'questionnaire schema validation failed',
          issues: [
            {
              path: 'sections[0].questions[0].id',
              code: 'DUPLICATE_ID',
              message: 'duplicate id',
            },
          ],
        }),
        { status: 400, headers: { 'content-type': 'application/json' } },
      ),
    );
    const client = createApiClient({ baseUrl: '/api', fetch: fetchImpl });

    try {
      await client.templateVersions.create(TEMPLATE_ID, {
        schema: { version: 1, title: 'X', sections: [] },
      });
      throw new Error('expected reject');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      const apiErr = err as ApiError;
      expect(apiErr.code).toBe('SCHEMA_INVALID');
      // The SCHEMA_INVALID payload uses a top-level `issues` field
      // outside the standard ErrorResponse envelope. The client
      // preserves it under `details` because ZErrorResponse accepts
      // unknown keys via passthrough — but the contract test on the
      // shape lives in @myreport/shared-schemas. Here we just assert
      // the code is surfaced so the front knows to render issues.
      expect(apiErr.status).toBe(400);
    }
  });
});
