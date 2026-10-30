"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { FormLoading } from "./form-loading";
import { api, message } from "../lib/api";
import {
  canEditMember,
  roleLabels,
  statusLabels,
  type Invitation,
  type Member,
  type TeamRole,
} from "../lib/team";
import { useWorkspace } from "./workspace-shell";
import { Icon } from "./icons";
import { RestaurantFilter } from "./restaurant-filter";
const EmployeeForm = dynamic(
  () => import("./employee-form").then((module) => module.EmployeeForm),
  { loading: FormLoading },
);
export default function EmployeesScreen() {
  const {
    restaurants,
    loading: workspaceLoading,
    error: workspaceError,
  } = useWorkspace();
  const manageable = restaurants.filter(
    (item) => item.role === "owner" || item.role === "manager",
  );
  const [selected, setSelected] = useState("");
  const restaurant =
    manageable.find((item) => item.id === selected) ?? manageable[0];
  const tenantId = restaurant?.id;
  const [data, setData] = useState<{
    tenantId: string;
    members: Member[];
    invitations: Invitation[];
  }>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Member | "new">();
  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!tenantId) return;
      const result = await api<{
        members: Member[];
        invitations: Invitation[];
      }>(`/tenants/${tenantId}/team`, { signal });
      if (!signal?.aborted) {
        setData({
          tenantId,
          members: result.members,
          invitations: result.invitations,
        });
        setError("");
      }
    },
    [tenantId],
  );
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setEditing(undefined);
    void load(controller.signal)
      .catch((error) => {
        if (!controller.signal.aborted) setError(message(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [load, retry]);
  const currentData = data?.tenantId === tenantId ? data : undefined;
  const members = currentData?.members ?? [];
  const query = search.trim().toLocaleLowerCase("pt-BR");
  const filtered = members.filter((member) =>
    `${member.display_name ?? ""} ${roleLabels[member.role]}`
      .toLocaleLowerCase("pt-BR")
      .includes(query),
  );
  const actor = restaurant?.role as TeamRole | undefined;
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">QUEM FAZ A CASA ACONTECER</span>
          <h1>Funcionários</h1>
          <p>Organize sua equipe e os acessos de cada pessoa.</p>
        </div>
        <button
          className="button compact-button"
          disabled={
            !restaurant || restaurant.status !== "active" || workspaceLoading
          }
          onClick={() => setEditing("new")}
        >
          <Icon name="plus" />
          Cadastrar funcionário
        </button>
      </div>
      {workspaceLoading ? (
        <p role="status">Carregando restaurantes…</p>
      ) : !restaurant ? (
        <section className="empty-state">
          <span className="step-icon">
            <Icon name="employees" />
          </span>
          <h2>
            {restaurants.length
              ? "Gestão de equipe restrita"
              : "Sua equipe começa com uma unidade"}
          </h2>
          <p>
            {workspaceError
              ? "Não foi possível consultar seus restaurantes. Tente novamente pelo aviso acima."
              : restaurants.length
                ? "Apenas administradores e gerentes podem cadastrar e gerenciar funcionários."
                : "Cadastre um restaurante para convidar sua equipe."}
          </p>
          <Link className="text-button" href="/restaurantes">
            Ver restaurantes →
          </Link>
        </section>
      ) : (
        <>
          <section className="team-toolbar" aria-label="Filtros da equipe">
            <RestaurantFilter
              restaurants={manageable}
              value={tenantId!}
              onChange={(id) => {
                setSelected(id);
                setSearch("");
                setEditing(undefined);
              }}
            />
            <label>
              Buscar funcionário
              <input
                type="search"
                placeholder="Busque por nome ou função"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
          </section>
          {restaurant.status !== "active" && (
            <p className="read-only-note">
              Esta unidade está suspensa. Novos convites estão indisponíveis.
            </p>
          )}
          {error && (
            <div className="error" role="alert">
              {error}
              <button
                className="text-button"
                onClick={() => setRetry((value) => value + 1)}
              >
                Tentar novamente
              </button>
            </div>
          )}
          {loading || (!currentData && !error) ? (
            <p role="status">Carregando equipe…</p>
          ) : (
            currentData && (
              <>
                <div className="team-summary">
                  <span>
                    <strong>
                      {
                        members.filter((item) => item.status === "active")
                          .length
                      }
                    </strong>{" "}
                    funcionários ativos
                  </span>
                  <span>
                    <strong>{currentData.invitations.length}</strong> convites
                    pendentes
                  </span>
                </div>
                <div className="team-grid">
                  {filtered.map((member) => (
                    <article className="team-card" key={member.user_id}>
                      <span className="team-avatar" aria-hidden="true">
                        {member.display_name?.trim().charAt(0).toUpperCase() ||
                          "C"}
                      </span>
                      <div className="team-card-info">
                        <h2>{member.display_name ?? "Funcionário"}</h2>
                        <p>{roleLabels[member.role]}</p>
                        <span className={`team-status ${member.status}`}>
                          {statusLabels[member.status]}
                        </span>
                      </div>
                      {actor && canEditMember(actor, member) && (
                        <button
                          className="text-button"
                          aria-label={`Editar ${member.display_name ?? "funcionário"}`}
                          onClick={() => setEditing(member)}
                        >
                          Editar →
                        </button>
                      )}
                    </article>
                  ))}
                </div>
                {!filtered.length && (
                  <section className="empty-state">
                    <h2>
                      {query
                        ? "Nenhum resultado"
                        : "Nenhum funcionário cadastrado"}
                    </h2>
                    <p>
                      {query
                        ? "Tente outro nome ou função."
                        : "Use Cadastrar funcionário para gerar o primeiro convite."}
                    </p>
                  </section>
                )}
                {!!currentData.invitations.length && (
                  <section className="team-invitations">
                    <h2>Convites pendentes</h2>
                    <p className="helper">
                      O funcionário aparece na equipe depois de aceitar o
                      convite.
                    </p>
                    <ul>
                      {currentData.invitations.map((invitation) => (
                        <li key={invitation.id}>
                          <div>
                            <strong>{invitation.email}</strong>
                            <span>{roleLabels[invitation.role]}</span>
                          </div>
                          <span>
                            Expira em{" "}
                            {new Date(invitation.expires_at).toLocaleString(
                              "pt-BR",
                              { dateStyle: "short", timeStyle: "short" },
                            )}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
              </>
            )
          )}
          {editing && actor && (
            <EmployeeForm
              key={tenantId}
              tenantId={tenantId!}
              actor={actor}
              member={editing === "new" ? undefined : editing}
              onClose={() => setEditing(undefined)}
              onSaved={() => load()}
            />
          )}
        </>
      )}
    </>
  );
}
