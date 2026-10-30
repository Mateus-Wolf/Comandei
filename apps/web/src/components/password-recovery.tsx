"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../lib/browser";
import { clearApiCache } from "../lib/api";
import { AuthLayout } from "./brand";

export default function PasswordRecovery({
  reset = false,
}: {
  reset?: boolean;
}) {
  const [ready, setReady] = useState(!reset);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!reset) return;
    let active = true;
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const recovery =
      hash.get("type") === "recovery" && !!hash.get("access_token");
    const client = supabase();
    void client.auth
      .getSession()
      .then(({ data, error }) => {
        if (!active) return;
        window.history.replaceState(null, "", "/auth/nova-senha");
        if (error || !data.session || !recovery) {
          setError(
            "Este link é inválido, expirou ou já foi usado. Solicite um novo link de recuperação.",
          );
        } else setReady(true);
      })
      .catch(() => {
        if (active)
          setError(
            "Não foi possível verificar o link. Solicite uma nova recuperação.",
          );
      });
    return () => {
      active = false;
    };
  }, [reset]);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !ready) return;
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    if (reset && password !== form.get("confirm")) {
      setError("As senhas precisam ser iguais.");
      return;
    }
    const email = String(form.get("email") ?? "")
      .trim()
      .toLowerCase();
    if (!reset && email.endsWith("@staff.comandei.internal")) {
      setError(
        "Para recuperar um acesso de funcionário, procure o administrador do restaurante.",
      );
      return;
    }
    setBusy(true);
    setError("");
    try {
      const client = supabase();
      const result = reset
        ? await client.auth.updateUser({ password })
        : await client.auth.resetPasswordForEmail(email, {
            redirectTo: `${window.location.origin}/auth/nova-senha`,
          });
      if (result.error) {
        const code = result.error.code;
        setError(
          code === "weak_password"
            ? "Escolha uma senha mais forte, com pelo menos 8 caracteres."
            : code === "same_password"
              ? "Escolha uma senha diferente da anterior."
              : code === "over_email_send_rate_limit" ||
                  code === "over_request_rate_limit"
                ? "Aguarde alguns minutos antes de tentar novamente."
                : "Não foi possível concluir. Confira sua conexão ou solicite um novo link.",
        );
        return;
      }
      if (reset) {
        clearApiCache();
        await client.auth.signOut({ scope: "local" });
      }
      setDone(true);
    } catch {
      setError(
        "Não foi possível concluir agora. Confira sua conexão e tente novamente.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <AuthLayout>
      <div className="form-content auth-form">
        <span className="eyebrow">RECUPERAÇÃO DE ACESSO</span>
        <h2>
          {done
            ? reset
              ? "Senha atualizada"
              : "Confira seu e-mail"
            : reset
              ? "Crie uma nova senha"
              : "Esqueceu sua senha?"}
        </h2>
        <p className="intro" role="status">
          {done
            ? reset
              ? "Sua nova senha foi salva. Entre novamente para continuar."
              : "Se houver uma conta com este e-mail, você receberá um link para redefinir a senha. Confira também o spam."
            : reset
              ? "Escolha uma senha com pelo menos 8 caracteres."
              : "Informe o e-mail da sua conta para receber o link de recuperação."}
        </p>
        {!done && ready && (
          <form onSubmit={submit} aria-busy={busy}>
            <fieldset
              disabled={busy}
              style={{ border: 0, padding: 0, margin: 0 }}
            >
              {reset ? (
                <>
                  <label>
                    Nova senha
                    <div className="password-field">
                      <input
                        name="password"
                        type={visible ? "text" : "password"}
                        autoComplete="new-password"
                        minLength={8}
                        maxLength={128}
                        required
                      />
                      <button
                        type="button"
                        className="reveal"
                        aria-pressed={visible}
                        onClick={() => setVisible(!visible)}
                      >
                        {visible ? "Ocultar" : "Mostrar"}
                      </button>
                    </div>
                  </label>
                  <label>
                    Confirme a nova senha
                    <input
                      name="confirm"
                      type={visible ? "text" : "password"}
                      autoComplete="new-password"
                      minLength={8}
                      maxLength={128}
                      required
                    />
                  </label>
                </>
              ) : (
                <label>
                  E-mail
                  <input
                    name="email"
                    type="email"
                    autoComplete="email"
                    maxLength={254}
                    required
                  />
                </label>
              )}
              <button className="button" type="submit">
                {busy
                  ? "Aguarde…"
                  : reset
                    ? "Salvar nova senha"
                    : "Enviar link de recuperação"}
              </button>
            </fieldset>
          </form>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {reset && !ready && !error && <p role="status">Verificando link…</p>}
        {reset && error && !ready && (
          <p>
            <Link href="/recuperar-senha">Solicitar novo link</Link>
          </p>
        )}
        {!reset && !done && (
          <p className="helper">
            Se você entra com um usuário de funcionário, procure o administrador
            do restaurante.
          </p>
        )}
        <p className="switch">
          <Link href="/entrar">Voltar para o login</Link>
        </p>
      </div>
    </AuthLayout>
  );
}
