"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, message, RequestError } from "../../lib/api";
import { supabase } from "../../lib/browser";
import {
  forgetInvitation,
  pendingInvitation,
  rememberInvitation,
} from "../../lib/team";
import { AuthLayout } from "../../components/brand";
export default function InvitationPage() {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const value = hash.get("token") ?? pendingInvitation();
    if (/^[A-Za-z0-9_-]{32,256}$/.test(value)) {
      setToken(value);
      rememberInvitation(value);
      window.history.replaceState(null, "", "/convite");
    } else
      setError(
        "O link do convite está incompleto. Solicite um novo convite ao administrador.",
      );
    void supabase()
      .auth.getUser()
      .then(({ data }) => {
        if (active) setEmail(data.user?.email ?? "");
      })
      .catch(() => {
        if (active)
          setError(
            "Não foi possível verificar sua conta. Tente recarregar a página.",
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);
  async function accept() {
    if (busy || !token) return;
    setBusy(true);
    setError("");
    try {
      const result = await api<{ tenant_id: string }>("/invitations/accept", {
        method: "POST",
        body: { token },
      });
      forgetInvitation();
      router.replace(`/restaurantes/${result.tenant_id}`);
    } catch (error) {
      setError(
        error instanceof RequestError && error.status === 403
          ? "Este convite pode ter expirado, já ter sido usado ou pertencer a outro e-mail. Confira a conta conectada ou solicite um novo convite."
          : message(error),
      );
      setBusy(false);
    }
  }
  return (
    <AuthLayout>
      <div className="form-content">
        <span className="eyebrow">BEM-VINDO À EQUIPE</span>
        <h2>Convite para o restaurante</h2>
        {loading ? (
          <p role="status">Verificando sua conta…</p>
        ) : (
          token &&
          (email ? (
            <>
              <p className="intro">
                Você está conectado como <strong>{email}</strong>. Aceite o
                convite para acessar a unidade. Use a conta com o mesmo e-mail
                que recebeu o convite.
              </p>
              <button
                className="button"
                disabled={busy}
                onClick={() => void accept()}
              >
                {busy ? "Vinculando sua conta…" : "Aceitar convite"}
              </button>
            </>
          ) : (
            <>
              <p className="intro">
                Entre ou crie sua conta usando o e-mail informado no convite.
                Depois, confirme o vínculo nesta tela.
              </p>
              <Link className="button" href="/entrar">
                Entrar na minha conta →
              </Link>
              <Link className="text-button" href="/cadastro">
                Criar minha conta
              </Link>
            </>
          ))
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <Link
          className="text-button"
          href="/home"
          onClick={() => forgetInvitation()}
        >
          Continuar sem aceitar o convite
        </Link>
      </div>
    </AuthLayout>
  );
}
