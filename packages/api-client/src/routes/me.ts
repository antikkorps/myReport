import { type MeResponse, ZMeResponse } from '@myreport/shared-schemas';
import type { ApiClientCore, RequestOptions } from '../client.ts';

export interface MeApi {
  get(options?: RequestOptions): Promise<MeResponse>;
}

export function createMeApi(core: ApiClientCore): MeApi {
  return {
    get(options) {
      return core.request({
        method: 'GET',
        path: '/me',
        responseSchema: ZMeResponse,
        ...(options ? { options } : {}),
      });
    },
  };
}
