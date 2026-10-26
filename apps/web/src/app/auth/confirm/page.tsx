"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "../../../lib/browser";
import { AuthLayout } from "../../../components/brand";
export default function Confirm() {
  const router = useRouter();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    void supabase()
      .auth.getSession()
      .then(({ data, error }) => {
        if (!active) return;
        if (error || !data.session) setFailed(true);
        else router.replace("/home");
        // Remove confirmation credentials/errors from the address bar after processing.
        window.history.replaceState(null, "", "/auth/confirm");
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [router]);
  return (
    <AuthLayout>
      <div className="form-content">
        <h2>{failed ? "Vamos tentar de novo?" : "Confirmando sua conta…"}</h2>
        <p className="intro" role="status">
          {failed
            ? "O link pode ter expirado ou já ter sido usado. Tente entrar com seu e-mail e senha. Se ainda não confirmou sua conta, solicite um novo cadastro."
            : "Estamos verificando sua confirmação de e-mail."}
        </p>
        {failed && (
          <Link className="button" href="/entrar">
            Ir para o login →
          </Link>
        )}
      </div>
    </AuthLayout>
  );
}
