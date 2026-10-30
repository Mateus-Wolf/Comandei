import {
  money,
  unitLabels,
  type StockOverview,
  type StockProduct,
} from "../lib/stock";
import { Icon } from "./icons";
export function StockProducts({
  data,
  canEdit,
  filtered,
  onEdit,
}: {
  data: StockOverview;
  canEdit: boolean;
  filtered: boolean;
  onEdit: (product: StockProduct) => void;
}) {
  return (
    <>
      <div
        className="stock-summary"
        aria-label="Resumo dos produtos da unidade"
      >
        {[
          ["Produtos cadastrados", data.summary.total],
          ["Disponíveis", data.summary.available],
          ["Indisponíveis", data.summary.unavailable],
          ["Inativos", data.summary.inactive],
        ].map(([label, value]) => (
          <div className="stock-stat" key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      {data.items.length ? (
        <div className="stock-table-wrap">
          <table className="stock-table">
            <caption className="sr-only">
              Produtos do restaurante selecionado
            </caption>
            <thead>
              <tr>
                <th scope="col">Produto</th>
                <th scope="col">Categoria</th>
                <th scope="col">Preço</th>
                <th scope="col">Situação</th>
                <th scope="col">
                  <span className="sr-only">Ações</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((product) => (
                <tr key={product.id}>
                  <td>
                    <strong>{product.name}</strong>
                    <span className="stock-sku">
                      {product.sku || "Sem código"}
                    </span>
                  </td>
                  <td>{product.category_name}</td>
                  <td>
                    <strong>{money(product.price_cents)}</strong>
                    <span className="stock-sku">
                      por {unitLabels[product.unit].toLocaleLowerCase("pt-BR")}
                    </span>
                  </td>
                  <td>
                    <span
                      className={`team-status ${!product.active ? "revoked" : !product.available ? "blocked" : "active"}`}
                    >
                      {!product.active
                        ? "Inativo"
                        : product.available
                          ? "Disponível"
                          : "Indisponível"}
                    </span>
                  </td>
                  <td>
                    {canEdit && (
                      <button
                        className="text-button"
                        onClick={() => onEdit(product)}
                        aria-label={`Editar ${product.name}`}
                      >
                        Editar →
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <section className="empty-state">
          <span className="step-icon">
            <Icon name="stock" />
          </span>
          <h2>
            {filtered
              ? "Nenhum produto encontrado"
              : "Seu estoque começa por aqui"}
          </h2>
          <p>
            {filtered
              ? "Tente outro nome, código, categoria ou situação."
              : data.categories.some((item) => item.active)
                ? "Cadastre o primeiro produto deste restaurante."
                : "Crie uma categoria para começar a cadastrar seus produtos."}
          </p>
        </section>
      )}
    </>
  );
}
