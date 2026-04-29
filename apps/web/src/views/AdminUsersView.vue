<script setup lang="ts">
import { ApiError } from '@myreport/api-client';
import {
  type CreateInvitationRequest,
  type InvitationListItem,
  type UserListItem,
  ZCreateInvitationRequest,
} from '@myreport/shared-schemas';
import Button from 'primevue/button';
import Card from 'primevue/card';
import Column from 'primevue/column';
import DataTable from 'primevue/datatable';
import Dialog from 'primevue/dialog';
import InputText from 'primevue/inputtext';
import Message from 'primevue/message';
import Select from 'primevue/select';
import { useToast } from 'primevue/usetoast';
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useApiClient } from '../api/client.ts';
import { useAuthStore } from '../stores/auth.ts';

const client = useApiClient();
const toast = useToast();
const auth = useAuthStore();
const router = useRouter();
const route = useRoute();

// Super-admin operates on a specific tenant by passing ?tenantId in the
// URL (typically arrived via the "Gérer les membres" button on
// /admin/tenants). Cabinet-admin's tenant comes from their auth context
// and the query param is ignored — RLS prevents cross-tenant access
// anyway, but stripping it here keeps the request clean.
const tenantOverride = computed<string | null>(() => {
  if (auth.user?.isSuperAdmin !== true) return null;
  const raw = route.query['tenantId'];
  if (typeof raw === 'string' && raw.length > 0) return raw;
  if (Array.isArray(raw) && typeof raw[0] === 'string' && raw[0].length > 0) return raw[0];
  return null;
});

const tenantOverrideMissing = computed(
  () => auth.user?.isSuperAdmin === true && !tenantOverride.value,
);

const tenantHeader = ref<string | null>(null);

async function loadTenantHeader(): Promise<void> {
  // Best-effort lookup of the tenant name for the page header. We
  // already have GET /tenants for super_admin; if the requested id
  // isn't there (deleted, typo) we surface a fatal banner.
  if (!tenantOverride.value) {
    tenantHeader.value = null;
    return;
  }
  try {
    const list = await client.tenants.list();
    const match = list.items.find((t) => t.id === tenantOverride.value);
    tenantHeader.value = match ? match.name : null;
  } catch {
    tenantHeader.value = null;
  }
}

const ROLE_OPTIONS = [
  { label: 'Auditor', value: 'auditor' as const },
  { label: 'Cabinet admin', value: 'cabinet_admin' as const },
];

const users = ref<UserListItem[]>([]);
const pendingInvitations = ref<InvitationListItem[]>([]);
const loading = ref(false);

async function refresh(): Promise<void> {
  if (tenantOverrideMissing.value) {
    // super_admin without an explicit tenantId: nothing to load. The
    // template surfaces a "pick a tenant first" banner.
    users.value = [];
    pendingInvitations.value = [];
    return;
  }
  loading.value = true;
  try {
    const tenantId = tenantOverride.value ?? undefined;
    const [u, inv] = await Promise.all([
      client.users.list(tenantId ? { tenantId } : undefined),
      client.invitations.list(tenantId ? { status: 'pending', tenantId } : { status: 'pending' }),
    ]);
    users.value = u.items;
    pendingInvitations.value = inv.items;
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: 'Erreur',
      detail: err instanceof ApiError ? err.message : 'Erreur réseau',
      life: 5000,
    });
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  await Promise.all([loadTenantHeader(), refresh()]);
});

// ---------------------------------------------------------------------
// Invite form
// ---------------------------------------------------------------------

const inviteEmail = ref('');
const inviteRole = ref<'auditor' | 'cabinet_admin'>('auditor');
const inviteSubmitting = ref(false);
const inviteSubmitted = ref(false);
const inviteError = ref<string | null>(null);

const inviteValidation = computed(() => {
  const result = ZCreateInvitationRequest.safeParse({
    email: inviteEmail.value,
    role: inviteRole.value,
  } satisfies CreateInvitationRequest);
  return result.success ? null : (result.error.issues[0]?.message ?? 'Champ invalide');
});

async function onInviteSubmit(): Promise<void> {
  inviteSubmitted.value = true;
  inviteError.value = null;
  if (inviteValidation.value) return;
  inviteSubmitting.value = true;
  try {
    const tenantId = tenantOverride.value ?? undefined;
    const created = await client.invitations.create({
      email: inviteEmail.value,
      role: inviteRole.value,
      ...(tenantId ? { tenantId } : {}),
    });
    toast.add({
      severity: 'success',
      summary: 'Invitation envoyée',
      detail: `${created.email} (${created.role})`,
      life: 4000,
    });
    inviteEmail.value = '';
    inviteRole.value = 'auditor';
    inviteSubmitted.value = false;
    await refresh();
  } catch (err) {
    if (err instanceof ApiError) {
      switch (err.code) {
        case 'ALREADY_MEMBER':
          inviteError.value = 'Cet email est déjà membre de ce cabinet.';
          break;
        case 'INVITATION_PENDING':
          inviteError.value =
            'Une invitation est déjà en attente pour cet email. Attendez son acceptation ou révoquez-la.';
          break;
        case 'EMAIL_TAKEN':
          inviteError.value = 'Cet email est déjà attaché à un compte existant.';
          break;
        case 'TENANT_ID_REQUIRED':
          inviteError.value =
            "Sélectionnez un cabinet depuis « Cabinets » avant d'envoyer une invitation.";
          break;
        case 'TENANT_NOT_FOUND':
          inviteError.value = "Ce cabinet n'existe plus.";
          break;
        default:
          inviteError.value = err.message;
      }
    } else {
      inviteError.value = 'Erreur réseau.';
    }
  } finally {
    inviteSubmitting.value = false;
  }
}

// ---------------------------------------------------------------------
// Role change (PATCH /memberships/:id)
// ---------------------------------------------------------------------

interface RoleChangePayload {
  member: UserListItem;
  newRole: 'auditor' | 'cabinet_admin';
}
const roleChangeRequest = ref<RoleChangePayload | null>(null);
const roleChangeSubmitting = ref(false);
const roleChangeError = ref<string | null>(null);

function onRoleSelect(member: UserListItem, newRole: 'auditor' | 'cabinet_admin'): void {
  if (newRole === member.role) return;
  // Guard for self-demotion. The API also enforces LAST_ADMIN, but the
  // confirmation modal makes the consequence explicit before the call.
  if (member.id === auth.user?.id) {
    roleChangeRequest.value = { member, newRole };
    roleChangeError.value = null;
    return;
  }
  void doRoleChange(member, newRole);
}

async function confirmRoleChange(): Promise<void> {
  const req = roleChangeRequest.value;
  if (!req) return;
  await doRoleChange(req.member, req.newRole, true);
}

function cancelRoleChange(): void {
  roleChangeRequest.value = null;
  roleChangeError.value = null;
  // Revert the visual state — the Select bound to row.role would
  // otherwise stay on the new value the user just picked.
  void refresh();
}

async function doRoleChange(
  member: UserListItem,
  newRole: 'auditor' | 'cabinet_admin',
  fromModal = false,
): Promise<void> {
  if (fromModal) roleChangeSubmitting.value = true;
  try {
    await client.memberships.update(member.membershipId, { role: newRole });
    toast.add({
      severity: 'success',
      summary: 'Rôle mis à jour',
      detail: `${member.displayName} → ${newRole}`,
      life: 3000,
    });
    if (member.id === auth.user?.id && newRole === 'auditor') {
      // Self-demotion: refresh /me so the auth store reflects the new
      // role; the sidebar entry vanishes and the next navigation to
      // /admin/users will be bounced home by the router guard.
      await syncSelfFromMe();
      await router.push({ name: 'home' });
    } else {
      await refresh();
    }
    roleChangeRequest.value = null;
  } catch (err) {
    const message =
      err instanceof ApiError && err.code === 'LAST_ADMIN'
        ? 'Impossible de rétrograder le dernier cabinet_admin actif.'
        : err instanceof ApiError
          ? err.message
          : 'Erreur réseau.';
    if (fromModal) {
      roleChangeError.value = message;
    } else {
      toast.add({ severity: 'error', summary: 'Erreur', detail: message, life: 4000 });
      await refresh();
    }
  } finally {
    if (fromModal) roleChangeSubmitting.value = false;
  }
}

async function syncSelfFromMe(): Promise<void> {
  // Re-hydrates auth.currentTenant.role after a self-demotion so the
  // sidebar visibility (`isAdmin`) updates without a full reload.
  try {
    const me = await client.me.get();
    auth.user = me.user;
    auth.currentTenant = me.currentTenant;
  } catch {
    // Best effort — the next navigation will re-fetch /me anyway.
  }
}

// ---------------------------------------------------------------------
// Remove membership (DELETE /memberships/:id)
// ---------------------------------------------------------------------

const removeRequest = ref<UserListItem | null>(null);
const removeSubmitting = ref(false);
const removeError = ref<string | null>(null);

function onRemoveClick(member: UserListItem): void {
  removeRequest.value = member;
  removeError.value = null;
}

function cancelRemove(): void {
  removeRequest.value = null;
  removeError.value = null;
}

async function confirmRemove(): Promise<void> {
  const target = removeRequest.value;
  if (!target) return;
  removeSubmitting.value = true;
  try {
    await client.memberships.remove(target.membershipId);
    if (target.id === auth.user?.id) {
      // Self-removal: API revoked our sessions. Drop local state and
      // bounce to /login. Do NOT call /auth/logout — the refresh
      // cookie is already invalidated server-side.
      auth.forceLocalLogout();
      await router.push({ name: 'login' });
      toast.add({
        severity: 'info',
        summary: 'Vous avez quitté ce cabinet',
        life: 4000,
      });
      return;
    }
    toast.add({
      severity: 'success',
      summary: 'Membre retiré',
      detail: target.displayName,
      life: 3000,
    });
    removeRequest.value = null;
    await refresh();
  } catch (err) {
    removeError.value =
      err instanceof ApiError && err.code === 'LAST_ADMIN'
        ? 'Impossible de retirer le dernier cabinet_admin actif.'
        : err instanceof ApiError
          ? err.message
          : 'Erreur réseau.';
  } finally {
    removeSubmitting.value = false;
  }
}

// ---------------------------------------------------------------------
// Revoke invitation (DELETE /invitations/:id)
// ---------------------------------------------------------------------

async function onRevokeInvitation(inv: InvitationListItem): Promise<void> {
  try {
    await client.invitations.revoke(inv.id);
    toast.add({
      severity: 'success',
      summary: 'Invitation révoquée',
      detail: inv.email,
      life: 3000,
    });
    await refresh();
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: 'Erreur',
      detail: err instanceof ApiError ? err.message : 'Erreur réseau',
      life: 4000,
    });
  }
}
</script>

<template>
  <div class="flex flex-col gap-6 max-w-5xl">
    <div class="flex flex-col gap-1">
      <h1 class="text-2xl sm:text-3xl font-semibold">
        {{ tenantHeader ? `Membres du cabinet — ${tenantHeader}` : 'Membres du cabinet' }}
      </h1>
      <p
        v-if="tenantOverride && !tenantHeader"
        class="text-sm text-surface-600 dark:text-surface-400"
      >
        Cabinet introuvable (peut-être supprimé). Retournez à la liste des cabinets.
      </p>
    </div>

    <Card v-if="tenantOverrideMissing">
      <template #title>Aucun cabinet sélectionné</template>
      <template #content>
        <p class="text-sm">
          En tant que super-administrateur vous devez d'abord choisir un cabinet pour gérer ses
          membres. Ouvrez la liste des cabinets et cliquez sur « Gérer les membres ».
        </p>
        <div class="mt-3">
          <Button
            label="Aller aux cabinets"
            icon="pi pi-arrow-right"
            outlined
            @click="router.push({ name: 'admin-tenants' })"
          />
        </div>
      </template>
    </Card>

    <Card v-if="!tenantOverrideMissing">
      <template #title>Inviter un membre</template>
      <template #content>
        <form class="flex flex-col gap-4" @submit.prevent="onInviteSubmit">
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label class="flex flex-col gap-1">
              <span class="text-sm">Email</span>
              <InputText
                v-model="inviteEmail"
                type="email"
                autocomplete="off"
                required
                data-testid="invite-email"
              />
            </label>
            <label class="flex flex-col gap-1">
              <span class="text-sm">Rôle</span>
              <Select
                v-model="inviteRole"
                :options="ROLE_OPTIONS"
                option-label="label"
                option-value="value"
                data-testid="invite-role"
              />
            </label>
          </div>

          <Message
            v-if="inviteSubmitted && inviteValidation"
            severity="error"
            :closable="false"
          >
            {{ inviteValidation }}
          </Message>
          <Message v-if="inviteError" severity="error" :closable="false">
            {{ inviteError }}
          </Message>

          <Button
            type="submit"
            label="Envoyer l'invitation"
            :loading="inviteSubmitting"
            :disabled="inviteSubmitting"
          />
        </form>
      </template>
    </Card>

    <Card v-if="!tenantOverrideMissing">
      <template #title>Membres actifs</template>
      <template #content>
        <DataTable
          :value="users"
          :loading="loading"
          responsive-layout="stack"
          breakpoint="640px"
          striped-rows
        >
          <Column field="displayName" header="Nom" />
          <Column field="email" header="Email" />
          <Column header="Rôle">
            <template #body="{ data }">
              <Select
                :model-value="data.role"
                :options="ROLE_OPTIONS"
                option-label="label"
                option-value="value"
                @update:model-value="(v: 'auditor' | 'cabinet_admin') => onRoleSelect(data, v)"
              />
            </template>
          </Column>
          <Column header="Membre depuis">
            <template #body="{ data }">
              {{ new Date(data.joinedAt).toLocaleDateString() }}
            </template>
          </Column>
          <Column header="Actions">
            <template #body="{ data }">
              <Button
                :label="data.id === auth.user?.id ? 'Quitter le cabinet' : 'Retirer'"
                icon="pi pi-trash"
                severity="danger"
                outlined
                @click="onRemoveClick(data)"
              />
            </template>
          </Column>
        </DataTable>
      </template>
    </Card>

    <Card v-if="pendingInvitations.length > 0">
      <template #title>Invitations en attente</template>
      <template #content>
        <DataTable
          :value="pendingInvitations"
          responsive-layout="stack"
          breakpoint="640px"
          striped-rows
        >
          <Column field="email" header="Email" />
          <Column field="role" header="Rôle" />
          <Column header="Expire le">
            <template #body="{ data }">
              {{ new Date(data.expiresAt).toLocaleString() }}
            </template>
          </Column>
          <Column header="Actions">
            <template #body="{ data }">
              <Button
                label="Révoquer"
                icon="pi pi-times"
                severity="secondary"
                outlined
                @click="onRevokeInvitation(data)"
              />
            </template>
          </Column>
        </DataTable>
      </template>
    </Card>

    <!-- Self-demotion confirmation -->
    <Dialog
      :visible="roleChangeRequest !== null"
      modal
      :closable="false"
      header="Confirmer la rétrogradation"
      :style="{ width: '28rem' }"
    >
      <p class="text-sm">
        Vous êtes sur le point de vous rétrograder en
        <strong>{{ roleChangeRequest?.newRole }}</strong>. Vous perdrez l'accès à cette page et au
        menu d'administration. Cette action n'est pas réversible par vous-même : un autre
        cabinet_admin devra vous re-promouvoir.
      </p>
      <Message v-if="roleChangeError" severity="error" :closable="false" class="mt-3">
        {{ roleChangeError }}
      </Message>
      <template #footer>
        <Button
          label="Annuler"
          text
          :disabled="roleChangeSubmitting"
          @click="cancelRoleChange"
        />
        <Button
          label="Confirmer"
          severity="danger"
          :loading="roleChangeSubmitting"
          :disabled="roleChangeSubmitting"
          @click="confirmRoleChange"
        />
      </template>
    </Dialog>

    <!-- Removal confirmation -->
    <Dialog
      :visible="removeRequest !== null"
      modal
      :closable="false"
      :header="
        removeRequest?.id === auth.user?.id
          ? 'Quitter ce cabinet ?'
          : 'Retirer ce membre ?'
      "
      :style="{ width: '28rem' }"
    >
      <p v-if="removeRequest?.id === auth.user?.id" class="text-sm">
        Vous allez quitter ce cabinet. Vos sessions actives seront révoquées et vous serez
        déconnecté(e) immédiatement. Vous garderez votre compte global mais devrez être
        ré-invité(e) pour revenir dans ce cabinet.
      </p>
      <p v-else class="text-sm">
        <strong>{{ removeRequest?.displayName }}</strong> ({{ removeRequest?.email }}) sera retiré
        du cabinet. Ses sessions actives sur ce cabinet seront révoquées immédiatement. Le compte
        global est conservé.
      </p>
      <Message v-if="removeError" severity="error" :closable="false" class="mt-3">
        {{ removeError }}
      </Message>
      <template #footer>
        <Button
          label="Annuler"
          text
          :disabled="removeSubmitting"
          @click="cancelRemove"
        />
        <Button
          :label="removeRequest?.id === auth.user?.id ? 'Quitter' : 'Retirer'"
          severity="danger"
          :loading="removeSubmitting"
          :disabled="removeSubmitting"
          @click="confirmRemove"
        />
      </template>
    </Dialog>
  </div>
</template>
