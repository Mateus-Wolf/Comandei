"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "../lib/browser";
import { AuthLayout } from "./brand";

function friendlyError(code?: string) {
  const messages: Record<string, string> = {
    invalid_credentials:
      "E-mail ou senha incorretos. Confira seus dados e tente novamente.",
    email_not_confirmed:
      "Confirme seu e-mail antes de entrar. Verifique também a caixa de spam.",
    user_already_exists:
      "Já existe uma conta com este e-mail. Acesse sua conta para continuar.",
    weak_password: "Escolha uma senha mais forte, com pelo menos 8 caracteres.",
    over_email_send_rate_limit:
      "Aguarde alguns minutos antes de solicitar outro e-mail.",
    over_request_rate_limit:
      "Muitas tentativas. Aguarde um pouco e tente novamente.",
    signup_disabled: "O cadastro está temporariamente indisponível.",
  };
  return (
    messages[code ?? ""] ??
    "Não foi possível concluir agora. Confira sua conexão e tente novamente."
  );
}
export default function AuthScreen({ mode }: { mode: "login" | "signup" }) {
  const signup = mode === "signup";
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [leaving, setLeaving] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const navigationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (navigationTimer.current) clearTimeout(navigationTimer.current);
    },
    [],
  );
  function navigate(event: { preventDefault: () => void }, href: string) {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    event.preventDefault();
    if (navigationTimer.current) return;
    setLeaving(true);
    navigationTimer.current = setTimeout(() => router.push(href), 160);
  }
  useEffect(() => {
    let active = true;
    try {
      void supabase()
        .auth.getSession()
        .then(({ data }) => {
          if (active && data.session) router.replace("/home");
        });
    } catch {
      setError(
        "O acesso ainda não foi configurado. Verifique as variáveis públicas do Supabase.",
      );
    }
    return () => {
      active = false;
    };
  }, [router]);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError("");
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email")).trim();
    const password = String(form.get("password"));
    const name = String(form.get("name") ?? "").trim();
    if (signup && !name) {
      setError("Informe seu nome.");
      return;
    }
    if (signup && password !== form.get("confirm")) {
      setError("As senhas precisam ser iguais.");
      return;
    }
    setBusy(true);
    try {
      const result = signup
        ? await supabase().auth.signUp({
            email,
            password,
            options: {
              data: { display_name: name },
              emailRedirectTo: `${window.location.origin}/auth/confirm`,
            },
          })
        : await supabase().auth.signInWithPassword({ email, password });
      if (result.error) {
        setError(friendlyError(result.error.code));
        return;
      }
      if (result.data.session) {
        setSignedIn(true);
        if (window.matchMedia("(prefers-reduced-motion: reduce)").matches)
          router.replace("/home");
        else
          navigationTimer.current = setTimeout(
            () => router.replace("/home"),
            240,
          );
      } else if (signup) setConfirmation(email);
    } catch {
      setError(friendlyError());
    } finally {
      setBusy(false);
    }
  }
  return (
    <AuthLayout exiting={signedIn}>
      <div
        className={`form-content auth-form ${signup ? "auth-signup" : "auth-login"} ${leaving ? "auth-leaving" : ""}`}
        inert={leaving || signedIn}
      >
        {confirmation ? (
          <>
            <span className="step-icon" aria-hidden="true">
              ✉
            </span>
            <span className="eyebrow">SÓ FALTA UM PASSO</span>
            <h2>Confira seu e-mail</h2>
            <p className="intro" role="status">
              Se o cadastro puder ser realizado, enviaremos um link para{" "}
              <strong>{confirmation}</strong>. Abra a mensagem para confirmar
              sua conta.
            </p>
            <p className="helper">
              Não encontrou? Confira o spam e, se já tiver uma conta, entre com
              sua senha.
            </p>
            <Link
              className="button"
              href="/entrar"
              onNavigate={(event) => navigate(event, "/entrar")}
            >
              Voltar para o login <span aria-hidden="true">→</span>
            </Link>
          </>
        ) : (
          <>
            <span className="eyebrow">
              {signup ? "VAMOS COMEÇAR" : "BOM TER VOCÊ POR AQUI"}
            </span>
            <h2>{signup ? "Crie sua conta" : "Entre na sua conta"}</h2>
            <p className="intro">
              {signup
                ? "Seu primeiro passo para uma operação mais leve."
                : "Tudo pronto para mais um dia de casa cheia."}
            </p>
            <form onSubmit={submit} aria-busy={busy}>
              {signup && (
                <label>
                  Seu nome
                  <input
                    name="name"
                    autoComplete="name"
                    required
                    maxLength={160}
                    placeholder="Como podemos chamar você?"
                  />
                </label>
              )}
              <label>
                E-mail
                <input
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  maxLength={254}
                  placeholder="voce@exemplo.com"
                />
              </label>
              <label>
                Senha
                <div className="password-field">
                  <input
                    name="password"
                    type={visible ? "text" : "password"}
                    autoComplete={signup ? "new-password" : "current-password"}
                    required
                    minLength={signup ? 8 : undefined}
                    maxLength={128}
                    placeholder={
                      signup ? "Crie uma senha segura" : "Digite sua senha"
                    }
                  />
                  <button
                    className="reveal"
                    type="button"
                    onClick={() => setVisible(!visible)}
                    aria-pressed={visible}
                    aria-label={visible ? "Ocultar senha" : "Mostrar senha"}
                  >
                    {visible ? "Ocultar" : "Mostrar"}
                  </button>
                </div>
              </label>
              {signup && (
                <>
                  <p className="field-hint">Use pelo menos 8 caracteres.</p>
                  <label>
                    Confirme a senha
                    <input
                      name="confirm"
                      type={visible ? "text" : "password"}
                      autoComplete="new-password"
                      required
                      minLength={8}
                      maxLength={128}
                      placeholder="Digite a senha novamente"
                    />
                  </label>
                </>
              )}
              {error && (
                <div className="error" role="alert">
                  {error}
                </div>
              )}
              <button className="button" type="submit" disabled={busy}>
                {signedIn
                  ? "Entrando…"
                  : busy
                    ? "Aguarde…"
                    : signup
                      ? "Criar minha conta"
                      : "Entrar"}
                <span aria-hidden="true">→</span>
              </button>
            </form>
            <p className="switch">
              {signup ? "Já tem uma conta?" : "Primeira vez por aqui?"}{" "}
              <Link
                href={signup ? "/entrar" : "/cadastro"}
                onNavigate={(event) =>
                  navigate(event, signup ? "/entrar" : "/cadastro")
                }
              >
                {signup ? "Entrar" : "Criar conta"}
              </Link>
            </p>
            {signup && (
              <p className="helper signup-note">
                O cadastro cria seu perfil pessoal. O acesso ao restaurante é
                liberado por convite da equipe.
              </p>
            )}
          </>
        )}
      </div>
    </AuthLayout>
  );
}
