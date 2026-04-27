import { createDatabase, type Database, type DatabaseHandle } from '@myreport/db';
import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';

declare module 'fastify' {
  interface FastifyInstance {
    db: Database;
    dbHandle: DatabaseHandle;
  }
}

const dbPlugin: FastifyPluginAsync<{ url: string }> = async (app, opts) => {
  const handle = createDatabase({ url: opts.url });
  app.decorate('db', handle.db);
  app.decorate('dbHandle', handle);
  app.addHook('onClose', async () => {
    await handle.close();
  });
};

export default fp(dbPlugin, { name: 'db' });
