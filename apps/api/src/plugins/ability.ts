import { schema } from '@myreport/db';
import {
  type AbilityContext,
  type Action,
  type AppAbility,
  defineAbilitiesFor,
  type MissionMembershipContext,
  type Subject,
  type SubjectName,
} from '@myreport/rbac';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

declare module 'fastify' {
  interface FastifyRequest {
    ability: AppAbility | null;
  }
  interface FastifyInstance {
    requireAbility: (
      action: Action,
      subject: 'all' | SubjectName | Subject,
    ) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

// Build the ability from the JWT claims and a single read of the
// memberships / mission_members rows for that user. Cached on the
// request object via `request.ability` so multiple `requireAbility`
// calls in the same handler share one DB lookup.
async function buildAbility(app: FastifyInstance, request: FastifyRequest): Promise<AppAbility> {
  if (request.ability) return request.ability;
  if (!request.auth) {
    throw app.httpErrors.unauthorized('authentication required');
  }
  const claims = request.auth;

  const tenantRole = claims.tenantId
    ? await app.withAdminTx(async (tx) => {
        const rows = await tx
          .select({ role: schema.memberships.role })
          .from(schema.memberships)
          .where(
            and(
              eq(schema.memberships.userId, claims.sub),
              eq(schema.memberships.tenantId, claims.tenantId ?? ''),
            ),
          )
          .limit(1);
        return rows[0]?.role ?? null;
      })
    : null;

  const missionMemberships: MissionMembershipContext[] = claims.tenantId
    ? await app.withAdminTx(async (tx) => {
        const rows = await tx
          .select({
            missionId: schema.missionMembers.missionId,
            role: schema.missionMembers.role,
          })
          .from(schema.missionMembers)
          .innerJoin(schema.missions, eq(schema.missions.id, schema.missionMembers.missionId))
          .where(
            and(
              eq(schema.missionMembers.userId, claims.sub),
              eq(schema.missions.tenantId, claims.tenantId ?? ''),
            ),
          );
        return rows;
      })
    : [];

  const context: AbilityContext = {
    user: { id: claims.sub, isSuperAdmin: claims.isSuperAdmin },
    tenantId: claims.tenantId,
    tenantRole,
    missionMemberships,
  };

  const ability = defineAbilitiesFor(context);
  request.ability = ability;
  return ability;
}

const abilityPlugin: FastifyPluginAsync = async (app) => {
  app.decorateRequest('ability', null);

  app.decorate(
    'requireAbility',
    function requireAbility(action: Action, subject: 'all' | SubjectName | Subject) {
      return async (request: FastifyRequest, _reply: FastifyReply) => {
        const ability = await buildAbility(app, request);
        if (!ability.can(action, subject)) {
          const subjectName = typeof subject === 'string' ? subject : subject.__subject;
          throw app.httpErrors.forbidden(`forbidden: ${action} on ${subjectName}`);
        }
      };
    },
  );
};

export default fp(abilityPlugin, {
  name: 'ability',
  dependencies: ['auth', 'dbContext'],
});
