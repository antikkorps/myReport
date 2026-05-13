import {
  type CreateQuestionnaireTemplateRequest,
  type QuestionnaireTemplate,
  type QuestionnaireTemplateListResponse,
  type UpdateQuestionnaireTemplateRequest,
  ZQuestionnaireTemplate,
  ZQuestionnaireTemplateListResponse,
} from '@myreport/shared-schemas';
import type { ApiClientCore, RequestOptions } from '../client.ts';

export interface TemplatesApi {
  create(
    body: CreateQuestionnaireTemplateRequest,
    options?: RequestOptions,
  ): Promise<QuestionnaireTemplate>;
  list(
    query?: { tenantId?: string },
    options?: RequestOptions,
  ): Promise<QuestionnaireTemplateListResponse>;
  get(id: string, options?: RequestOptions): Promise<QuestionnaireTemplate>;
  update(
    id: string,
    body: UpdateQuestionnaireTemplateRequest,
    options?: RequestOptions,
  ): Promise<QuestionnaireTemplate>;
  remove(id: string, options?: RequestOptions): Promise<void>;
}

export function createTemplatesApi(core: ApiClientCore): TemplatesApi {
  return {
    create(body, options) {
      return core.request({
        method: 'POST',
        path: '/templates',
        body,
        responseSchema: ZQuestionnaireTemplate,
        ...(options ? { options } : {}),
      });
    },
    list(query, options) {
      const path = query?.tenantId
        ? `/templates?tenantId=${encodeURIComponent(query.tenantId)}`
        : '/templates';
      return core.request({
        method: 'GET',
        path,
        responseSchema: ZQuestionnaireTemplateListResponse,
        ...(options ? { options } : {}),
      });
    },
    get(id, options) {
      return core.request({
        method: 'GET',
        path: `/templates/${encodeURIComponent(id)}`,
        responseSchema: ZQuestionnaireTemplate,
        ...(options ? { options } : {}),
      });
    },
    update(id, body, options) {
      return core.request({
        method: 'PATCH',
        path: `/templates/${encodeURIComponent(id)}`,
        body,
        responseSchema: ZQuestionnaireTemplate,
        ...(options ? { options } : {}),
      });
    },
    remove(id, options) {
      return core.request({
        method: 'DELETE',
        path: `/templates/${encodeURIComponent(id)}`,
        ...(options ? { options } : {}),
      });
    },
  };
}
