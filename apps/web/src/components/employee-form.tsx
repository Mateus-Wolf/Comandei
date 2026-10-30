"use client";
import { useRef, useState } from "react";
import { api, message } from "../lib/api";
import {
  editableRoles,
  roleLabels,
  type Member,
  type TeamRole,
} from "../lib/team";
import { Dialog } from "./dialog";
export function EmployeeForm({
  tenantId,
  actor,
  member,
  onClose,
  onSaved,
}: {
  tenantId: string;
  actor: TeamRole;
  member?: Member;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [createLogin, setCreateLogin] = useState(false);
  const [role, setRole] = useState(member?.role ?? "waiter");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [link, setLink] = useState("");
  const [copied, setCopied] = useState(false);
  const mutation = useRef<{ signature: string; key: string } | undefined>(
    undefined,
  );
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    const body = member
      ? { role: form.get("role"), status: form.get("status") }
      : createLogin
        ? {
            display_name: String(form.get("display_name")).trim(),
            username: String(form.get("username")).trim().toLowerCase(),
            password: String(form.get("password")),
            role: form.get("role"),
          }
        : {
            email: String(form.get("email")).trim().toLowerCase(),
            role: form.get("role"),
          };
    const signature = JSON.stringify(body);
    if (mutation.current?.signature !== signature)
      mutation.current = { signature, key: crypto.randomUUID() };
    setBusy(true);
    setError("");
    try {
      if (member) {
        await api(`/tenants/${tenantId}/members/${member.user_id}`, {
          method: "PATCH",
          body,
          key: mutation.current!.key,
        });
        await onSaved();
        onClose();
      } else if (createLogin) {
        if (form.get("password") !== form.get("confirm_password")) {
          setError("As senhas precisam ser iguais.");
          return;
        }
        await api(`/tenants/${tenantId}/employee-logins`, {
          method: "POST",
          body,
          key: mutation.current!.key,
        });
        await onSaved();
        onClose();
      } else {
        const result = await api<{ token: string }>(
          `/tenants/${tenantId}/invitations`,
          { method: "POST", body, key: mutation.current!.key },
        );
        setLink(
          `${window.location.origin}/convite#token=${encodeURIComponent(result.token)}`,
        );
        await onSaved();
      }
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title={
        member
          ? "Editar funcionário"
          : link
            ? "Convite criado"
            : "Cadastrar funcionário"
      }
      onClose={onClose}
      busy={busy}
    >
      {link ? (
        <>
          <p className="helper">
            Compartilhe este link com o funcionário. Ele deverá entrar ou criar
            uma conta com o e-mail informado e aceitar o convite. O link vale
            por 48 horas.
          </p>
          <label>
            Link do convite
            <input
              readOnly
              value={link}
              onFocus={(event) => event.target.select()}
            />
          </label>
          <p className="field-hint">
            O convite foi gerado. Nenhum e-mail foi enviado automaticamente.
          </p>
          <div className="dialog-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={onClose}
              disabled={busy}
            >
              Concluir
            </button>
            <button
              type="button"
              className="button compact-button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(link);
                  setCopied(true);
                } catch {
                  setError("Selecione o link acima e copie manualmente.");
                }
              }}
            >
              {copied ? "Link copiado" : "Copiar link"}
            </button>
          </div>
          <p role="status" className="field-hint">
            {copied ? "Link copiado para a área de transferência." : ""}
          </p>
        </>
      ) : (
        <form onSubmit={submit} aria-busy={busy}>
          <p className="helper">
            {member
              ? `Atualize a função e o acesso de ${member.display_name ?? "este funcionário"}.`
              : "Crie um login para o funcionário ou envie um convite por e-mail."}
          </p>
          <fieldset disabled={busy}>
            {!member && (
              <label>
                <span>
                  <input
                    type="checkbox"
                    checked={createLogin}
                    onChange={(event) => {
                      setCreateLogin(event.target.checked);
                      if (role !== "waiter" && role !== "cashier")
                        setRole("waiter");
                    }}
                  />{" "}
                  Cadastrar como usuário também
                </span>
              </label>
            )}
            {!member && createLogin && (
              <>
                <label>
                  Nome do funcionário
                  <input
                    name="display_name"
                    required
                    maxLength={160}
                    autoComplete="name"
                  />
                </label>
                <label>
                  Usuário
                  <input
                    name="username"
                    required
                    minLength={3}
                    maxLength={40}
                    pattern="[a-z0-9][a-z0-9._\-]*"
                    autoCapitalize="none"
                    autoComplete="off"
                  />
                </label>
                <p className="field-hint">
                  Use de 3 a 40 letras minúsculas, números, pontos, traços ou
                  sublinhados. O usuário deve ser único.
                </p>
                <label>
                  Senha
                  <input
                    name="password"
                    type="password"
                    required
                    minLength={8}
                    maxLength={128}
                    autoComplete="new-password"
                  />
                </label>
                <label>
                  Confirmar senha
                  <input
                    name="confirm_password"
                    type="password"
                    required
                    minLength={8}
                    maxLength={128}
                    autoComplete="new-password"
                  />
                </label>
              </>
            )}
            {!member && !createLogin && (
              <label>
                E-mail do funcionário
                <input
                  name="email"
                  type="email"
                  required
                  maxLength={254}
                  autoComplete="email"
                  placeholder="nome@exemplo.com"
                />
              </label>
            )}
            <label>
              Função
              <select
                name="role"
                value={role}
                onChange={(event) => setRole(event.target.value as TeamRole)}
              >
                {editableRoles(actor)
                  .filter(
                    (item) =>
                      !createLogin || item === "waiter" || item === "cashier",
                  )
                  .map((role) => (
                    <option key={role} value={role}>
                      {roleLabels[role]}
                    </option>
                  ))}
              </select>
            </label>
            <p className="field-hint">
              Garçons registram pedidos; operadores de caixa também recebem
              pagamentos; gerentes administram a operação e a equipe.
            </p>
            {member && (
              <label>
                Acesso
                <select name="status" defaultValue={member.status}>
                  <option value="active">Ativo</option>
                  <option value="blocked">Bloqueado</option>
                  <option value="revoked">Revogado</option>
                </select>
              </label>
            )}
          </fieldset>
          <div className="dialog-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={onClose}
              disabled={busy}
            >
              Cancelar
            </button>
            <button
              className="button compact-button"
              type="submit"
              disabled={busy}
            >
              {busy
                ? "Salvando…"
                : member
                  ? "Salvar alterações"
                  : createLogin
                    ? "Cadastrar funcionário e login"
                    : "Gerar convite"}
            </button>
          </div>
        </form>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </Dialog>
  );
}
