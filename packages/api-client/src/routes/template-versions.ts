import {
  type CreateQuestionnaireTemplateVersionRequest,
  type QuestionnaireTemplateVersion,
  type QuestionnaireTemplateVersionListResponse,
  type QuestionnaireTemplateVersionStatus,
  type UpdateQuestionnaireTemplateVersionRequest,
  ZQuestionnaireTemplateVersion,
  ZQuestionnaireTemplateVersionListResponse,
} from '@myreport/shared-schemas';
import type { ApiClientCore, RequestOptions } from '../client.ts';

export interface TemplateVersionsListQuery {
  status?: QuestionnaireTemplateVersionStatus | 'all';
}

export interface TemplateVersionsApi {
  create(
    templateId: string,
    body: CreateQuestionnaireTemplateVersionRequest,
    options?: RequestOptions,
  ): Promise<QuestionnaireTemplateVersion>;
  list(
    templateId: string,
    query?: TemplateVersionsListQuery,
    options?: RequestOptions,
  ): Promise<QuestionnaireTemplateVersionListResponse>;
  get(
    templateId: string,
    versionId: string,
    options?: RequestOptions,
  ): Promise<QuestionnaireTemplateVersion>;
  update(
    templateId: string,
    versionId: string,
    body: UpdateQuestionnaireTemplateVersionRequest,
    options?: RequestOptions,
  ): Promise<QuestionnaireTemplateVersion>;
  publish(
    templateId: string,
    versionId: string,
    options?: RequestOptions,
  ): Promise<QuestionnaireTemplateVersion>;
  archive(
    templateId: string,
    versionId: string,
    options?: RequestOptions,
  ): Promise<QuestionnaireTemplateVersion>;
  promote(
    templateId: string,
    versionId: string,
    options?: RequestOptions,
  ): Promise<QuestionnaireTemplateVersion>;
  remove(templateId: string, versionId: string, options?: RequestOptions): Promise<void>;
}

export function createTemplateVersionsApi(core: ApiClientCore): TemplateVersionsApi {
  function basePath(templateId: string): string {
    return `/templates/${encodeURIComponent(templateId)}/versions`;
  }
  function versionPath(templateId: string, versionId: string): string {
    return `${basePath(templateId)}/${encodeURIComponent(versionId)}`;
  }

  return {
    create(templateId, body, options) {
      return core.request({
        method: 'POST',
        path: basePath(templateId),
        body,
        responseSchema: ZQuestionnaireTemplateVersion,
        ...(options ? { options } : {}),
      });
    },
    list(templateId, query, options) {
      const path = query?.status
        ? `${basePath(templateId)}?status=${query.status}`
        : basePath(templateId);
      return core.request({
        method: 'GET',
        path,
        responseSchema: ZQuestionnaireTemplateVersionListResponse,
        ...(options ? { options } : {}),
      });
    },
    get(templateId, versionId, options) {
      return core.request({
        method: 'GET',
        path: versionPath(templateId, versionId),
        responseSchema: ZQuestionnaireTemplateVersion,
        ...(options ? { options } : {}),
      });
    },
    update(templateId, versionId, body, options) {
      return core.request({
        method: 'PATCH',
        path: versionPath(templateId, versionId),
        body,
        responseSchema: ZQuestionnaireTemplateVersion,
        ...(options ? { options } : {}),
      });
    },
    publish(templateId, versionId, options) {
      return core.request({
        method: 'POST',
        path: `${versionPath(templateId, versionId)}/publish`,
        responseSchema: ZQuestionnaireTemplateVersion,
        ...(options ? { options } : {}),
      });
    },
    archive(templateId, versionId, options) {
      return core.request({
        method: 'POST',
        path: `${versionPath(templateId, versionId)}/archive`,
        responseSchema: ZQuestionnaireTemplateVersion,
        ...(options ? { options } : {}),
      });
    },
    promote(templateId, versionId, options) {
      return core.request({
        method: 'POST',
        path: `${versionPath(templateId, versionId)}/promote`,
        responseSchema: ZQuestionnaireTemplateVersion,
        ...(options ? { options } : {}),
      });
    },
    remove(templateId, versionId, options) {
      return core.request({
        method: 'DELETE',
        path: versionPath(templateId, versionId),
        ...(options ? { options } : {}),
      });
    },
  };
}
