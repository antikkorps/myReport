import { describe, expect, it } from 'vitest';
import { ApiContractError, ApiError, createApiClient } from '../src/index.ts';

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

const sampleTemplate = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  tenantId: '550e8400-e29b-41d4-a716-446655440001',
  name: 'Audit financier',
  slug: 'audit-financier',
  description: 'Modèle standard',
  currentVersionId: null,
  createdAt: '2026-05-13T10:00:00.000Z',
  updatedAt: '2026-05-13T10:00:00.000Z',
};

describe('templates api', () => {
  it('POST /templates serialises the body and returns the parsed row', async () => {
    const calls: FetchCall[] = [];
    const fetchImpl = makeFetch(
      new Response(JSON.stringify(sampleTemplate), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      }),
      calls,
    );
    const client = createApiClient({
      baseUrl: '/api',
      fetch: fetchImpl,
      getAccessToken: () => 'jwt-xyz',
    });

    const result = await client.templates.create({
      name: 'Audit financier',
      slug: 'audit-financier',
      description: 'Modèle standard',
    });

    expect(result.id).toBe(sampleTemplate.id);
    const call = calls[0];
    if (!call) throw new Error('expected one fetch call');
    expect(call.url).toBe('/api/templates');
    expect(call.init.method).toBe('POST');
    const body = JSON.parse((call.init.body as string) ?? '{}');
    expect(body).toEqual({
      name: 'Audit financier',
      slug: 'audit-financier',
      description: 'Modèle standard',
    });
  });

  it('POST /templates forwards tenantId when super_admin provides one', async () => {
    const calls: FetchCall[] = [];
    const fetchImpl = makeFetch(
      new Response(JSON.stringify(sampleTemplate), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      }),
      calls,
    );
    const client = createApiClient({ baseUrl: '/api', fetch: fetchImpl });

    await client.templates.create({
      name: 'Audit financier',
      slug: 'audit-financier',
      tenantId: sampleTemplate.tenantId,
    });

    const call = calls[0];
    if (!call) throw new Error('expected one fetch call');
    const body = JSON.parse((call.init.body as string) ?? '{}');
    expect(body.tenantId).toBe(sampleTemplate.tenantId);
  });

  it('GET /templates without query hits the bare path (cabinet_admin scoping)', async () => {
    const calls: FetchCall[] = [];
    const fetchImpl = makeFetch(
      new Response(JSON.stringify({ items: [sampleTemplate] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
      calls,
    );
    const client = createApiClient({ baseUrl: '/api', fetch: fetchImpl });

    const result = await client.templates.list();

    expect(result.items).toHaveLength(1);
    const call = calls[0];
    if (!call) throw new Error('expected one fetch call');
    expect(call.url).toBe('/api/templates');
  });

  it('GET /templates with tenantId encodes the query string', async () => {
    const calls: FetchCall[] = [];
    const fetchImpl = makeFetch(
      new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
      calls,
    );
    const client = createApiClient({ baseUrl: '/api', fetch: fetchImpl });

    await client.templates.list({ tenantId: sampleTemplate.tenantId });

    const call = calls[0];
    if (!call) throw new Error('expected one fetch call');
    expect(call.url).toBe(`/api/templates?tenantId=${sampleTemplate.tenantId}`);
  });

  it('GET /templates/:id parses the row', async () => {
    const calls: FetchCall[] = [];
    const fetchImpl = makeFetch(
      new Response(JSON.stringify(sampleTemplate), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
      calls,
    );
    const client = createApiClient({ baseUrl: '/api', fetch: fetchImpl });

    const result = await client.templates.get(sampleTemplate.id);

    expect(result.slug).toBe('audit-financier');
    const call = calls[0];
    if (!call) throw new Error('expected one fetch call');
    expect(call.url).toBe(`/api/templates/${sampleTemplate.id}`);
    expect(call.init.method).toBe('GET');
  });

  it('PATCH /templates/:id serialises the patch body', async () => {
    const calls: FetchCall[] = [];
    const fetchImpl = makeFetch(
      new Response(JSON.stringify({ ...sampleTemplate, name: 'Audit Q1' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
      calls,
    );
    const client = createApiClient({ baseUrl: '/api', fetch: fetchImpl });

    const result = await client.templates.update(sampleTemplate.id, { name: 'Audit Q1' });

    expect(result.name).toBe('Audit Q1');
    const call = calls[0];
    if (!call) throw new Error('expected one fetch call');
    expect(call.url).toBe(`/api/templates/${sampleTemplate.id}`);
    expect(call.init.method).toBe('PATCH');
    const body = JSON.parse((call.init.body as string) ?? '{}');
    expect(body).toEqual({ name: 'Audit Q1' });
  });

  it('DELETE /templates/:id resolves on 204', async () => {
    const calls: FetchCall[] = [];
    const fetchImpl = makeFetch(new Response(null, { status: 204 }), calls);
    const client = createApiClient({ baseUrl: '/api', fetch: fetchImpl });

    await expect(client.templates.remove(sampleTemplate.id)).resolves.toBeUndefined();

    const call = calls[0];
    if (!call) throw new Error('expected one fetch call');
    expect(call.url).toBe(`/api/templates/${sampleTemplate.id}`);
    expect(call.init.method).toBe('DELETE');
  });

  it('surfaces ApiError on 409 SLUG_TAKEN', async () => {
    const fetchImpl = makeFetch(
      new Response(JSON.stringify({ code: 'SLUG_TAKEN', message: 'slug already in use' }), {
        status: 409,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const client = createApiClient({ baseUrl: '/api', fetch: fetchImpl });

    await expect(client.templates.create({ name: 'X', slug: 'taken-slug' })).rejects.toMatchObject({
      name: 'ApiError',
      status: 409,
      code: 'SLUG_TAKEN',
    });
  });

  it('surfaces ApiError on 400 TENANT_ID_REQUIRED', async () => {
    const fetchImpl = makeFetch(
      new Response(JSON.stringify({ code: 'TENANT_ID_REQUIRED', message: 'tenantId required' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const client = createApiClient({ baseUrl: '/api', fetch: fetchImpl });

    try {
      await client.templates.list();
      throw new Error('expected reject');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).code).toBe('TENANT_ID_REQUIRED');
    }
  });

  it('throws ApiContractError when the response shape drifts (missing currentVersionId)', async () => {
    const { currentVersionId: _omit, ...broken } = sampleTemplate;
    const fetchImpl = makeFetch(
      new Response(JSON.stringify(broken), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const client = createApiClient({ baseUrl: '/api', fetch: fetchImpl });

    await expect(client.templates.get(sampleTemplate.id)).rejects.toBeInstanceOf(ApiContractError);
  });
});
