import type { Database } from '@myreport/db';
import { sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';

export interface TenantContext {
  userId: string;
  tenantId: string | null;
}

declare module 'fastify' {
  interface FastifyInstance {
    withAdminTx: <T>(fn: (tx: Database) => Promise<T>) => Promise<T>;
    withTenantTx: <T>(ctx: TenantContext, fn: (tx: Database) => Promise<T>) => Promise<T>;
  }
}

// Wraps a callback in a Postgres transaction with the proper role +
// per-request GUCs so RLS policies kick in. `app_user` is the default
// for authenticated routes; pre-auth flows (login, refresh, logout)
// must use `app_admin` because they look up rows before a tenant
// context is available.
const dbContextPlugin: FastifyPluginAsync = async (app) => {
  app.decorate('withAdminTx', async function withAdminTx<T>(fn: (tx: Database) => Promise<T>) {
    return app.db.transaction(async (tx) => {
      await tx.execute(sql`set local role app_admin`);
      return fn(tx);
    });
  });

  app.decorate('withTenantTx', async function withTenantTx<
    T,
  >(ctx: TenantContext, fn: (tx: Database) => Promise<T>) {
    return app.db.transaction(async (tx) => {
      await tx.execute(sql`set local role app_user`);
      await tx.execute(sql`select set_config('app.current_user_id', ${ctx.userId}, true)`);
      await tx.execute(
        sql`select set_config('app.current_tenant_id', ${ctx.tenantId ?? ''}, true)`,
      );
      return fn(tx);
    });
  });
};

export default fp(dbContextPlugin, { name: 'dbContext', dependencies: ['db'] });
