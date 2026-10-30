"use client";
import { useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { FormLoading } from "./form-loading";
import { useRouter } from "next/navigation";
import { useWorkspace } from "./workspace-shell";
import { RestaurantPhoto } from "./restaurant-photo";
import { Icon } from "./icons";
import { serviceLabels } from "../lib/api";
const RestaurantForm = dynamic(
  () => import("./restaurant-form").then((module) => module.RestaurantForm),
  { loading: FormLoading },
);
export default function RestaurantsScreen() {
  const { restaurants, canCreate, loading, reload, error } = useWorkspace();
  const [creating, setCreating] = useState(false);
  const router = useRouter();
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">SUAS UNIDADES</span>
          <h1>Restaurantes</h1>
          <p>Escolha uma unidade para visualizar suas mesas.</p>
        </div>
        <button
          className="button compact-button"
          onClick={() => setCreating(true)}
          disabled={loading || !canCreate}
          title={
            !canCreate
              ? "Apenas administradores podem criar restaurantes"
              : undefined
          }
        >
          <Icon name="plus" />
          Criar restaurante
        </button>
      </div>
      {loading ? (
        <p role="status">Carregando restaurantes…</p>
      ) : error && !restaurants.length ? (
        <p className="helper">
          A listagem estará disponível assim que a conexão for restabelecida.
        </p>
      ) : restaurants.length ? (
        <div className="restaurant-grid">
          {restaurants.map((restaurant) => (
            <Link
              className="restaurant-card"
              key={restaurant.id}
              href={`/restaurantes/${restaurant.id}`}
            >
              <RestaurantPhoto
                path={restaurant.photo_path}
                name={restaurant.name}
              />
              <div className="restaurant-card-body">
                <div className="card-title">
                  <h2>{restaurant.name}</h2>
                  <span aria-hidden="true">↗</span>
                </div>
                <span className="badge">
                  {serviceLabels[restaurant.service_type]}
                </span>
                <p className="card-address">
                  {restaurant.address ?? "Endereço não informado"}
                </p>
                <div className="card-foot">
                  <span>
                    {restaurant.opens_at && restaurant.closes_at
                      ? `${restaurant.opens_at.slice(0, 5)} – ${restaurant.closes_at.slice(0, 5)}`
                      : "Horário não informado"}
                  </span>
                  <span>
                    {restaurant.status === "active"
                      ? "Ver mesas →"
                      : "Unidade suspensa"}
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <span className="step-icon">
            <Icon name="restaurants" />
          </span>
          <h2>Nenhum restaurante por aqui</h2>
          <p>
            {canCreate
              ? "Crie seu primeiro restaurante para começar a organizar as mesas."
              : "Solicite um convite ao administrador para acessar uma unidade."}
          </p>
        </div>
      )}
      {!loading && !canCreate && !error && (
        <p className="helper">
          Você pode visualizar os restaurantes vinculados à sua conta. O
          cadastro e a edição são exclusivos do administrador.
        </p>
      )}
      {creating && (
        <RestaurantForm
          onClose={() => setCreating(false)}
          onPersisted={reload}
          onSaved={(id) => {
            setCreating(false);
            router.push(`/restaurantes/${id}`);
          }}
        />
      )}
    </>
  );
}
