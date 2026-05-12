// Domain subjects we authorise on. Each entity carries a discriminator
// (`__subject`) so CASL can match per instance — checks like
// `ability.can('update', mission)` rely on it.

export type TenantRole = 'cabinet_admin' | 'auditor';
export type MissionRole = 'lead' | 'contributor' | 'observer';

export interface TenantSubject {
  readonly __subject: 'Tenant';
  readonly id: string;
}

export interface UserSubject {
  readonly __subject: 'User';
  readonly id: string;
}

export interface MembershipSubject {
  readonly __subject: 'Membership';
  readonly id: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly role: TenantRole;
}

export interface MissionSubject {
  readonly __subject: 'Mission';
  readonly id: string;
  readonly tenantId: string;
}

export interface MissionMemberSubject {
  readonly __subject: 'MissionMember';
  readonly id: string;
  readonly tenantId: string;
  readonly missionId: string;
  readonly userId: string;
  readonly role: MissionRole;
}

export interface InvitationSubject {
  readonly __subject: 'Invitation';
  readonly id: string;
  readonly tenantId: string;
  readonly role: TenantRole;
}

export interface TemplateSubject {
  readonly __subject: 'Template';
  readonly id: string;
  readonly tenantId: string;
}

export type TemplateVersionStatus = 'draft' | 'published' | 'archived';

export interface TemplateVersionSubject {
  readonly __subject: 'TemplateVersion';
  readonly id: string;
  readonly tenantId: string;
  readonly templateId: string;
  readonly status: TemplateVersionStatus;
}

export type Subject =
  | TenantSubject
  | UserSubject
  | MembershipSubject
  | MissionSubject
  | MissionMemberSubject
  | InvitationSubject
  | TemplateSubject
  | TemplateVersionSubject;

export type SubjectName = Subject['__subject'];

export const SUBJECT_NAMES: readonly SubjectName[] = [
  'Tenant',
  'User',
  'Membership',
  'Mission',
  'MissionMember',
  'Invitation',
  'Template',
  'TemplateVersion',
] as const;
