export type TeamRole = "owner" | "manager" | "cashier" | "waiter";
export type Member = {
  user_id: string;
  display_name: string | null;
  role: TeamRole;
  status: "active" | "blocked" | "revoked";
};
export type Invitation = {
  id: string;
  email: string;
  role: TeamRole;
  expires_at: string;
};
export const roleLabels: Record<TeamRole, string> = {
  owner: "Administrador",
  manager: "Gerente",
  cashier: "Operador de caixa",
  waiter: "Garçom",
};
export const statusLabels = {
  active: "Ativo",
  blocked: "Bloqueado",
  revoked: "Acesso revogado",
};
export function editableRoles(actor: TeamRole): TeamRole[] {
  return actor === "owner"
    ? ["manager", "cashier", "waiter"]
    : actor === "manager"
      ? ["cashier", "waiter"]
      : [];
}
export function canEditMember(actor: TeamRole, member: Member) {
  return member.role !== "owner" && editableRoles(actor).includes(member.role);
}
const invitationKey = "comandei.pending-invitation";
export function pendingInvitation() {
  try {
    return sessionStorage.getItem(invitationKey) ?? "";
  } catch {
    return "";
  }
}
export function rememberInvitation(token: string) {
  try {
    sessionStorage.setItem(invitationKey, token);
  } catch {
    /* The original link remains available. */
  }
}
export function forgetInvitation() {
  try {
    sessionStorage.removeItem(invitationKey);
  } catch {
    /* Storage may be unavailable. */
  }
}
export function postLoginPath() {
  return pendingInvitation() ? "/convite" : "/home";
}
