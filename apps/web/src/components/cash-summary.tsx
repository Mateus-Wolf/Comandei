import {
  activityLabels,
  cashDate,
  methodLabels,
  money,
  type CashOverview,
} from "../lib/cash";
export function CashSummary({ data }: { data: CashOverview }) {
  const session = data.session;
  return (
    <>
      <div className="stock-summary cash-summary">
        {[
          ["Dinheiro esperado", data.totals.expected_cash_cents],
          ["Recebimentos líquidos", data.totals.receipts_cents],
          ["Suprimentos", data.totals.supply_cents],
          ["Sangrias", data.totals.withdrawal_cents],
        ].map(([label, amount]) => (
          <div className="stock-stat" key={label}>
            <span>{label}</span>
            <strong>{money(Number(amount))}</strong>
          </div>
        ))}
      </div>
      {session && (
        <section className="cash-session-note">
          <div>
            <strong>{session.register_name}</strong>
            <span
              className={`team-status ${session.status === "open" ? "active" : "revoked"}`}
            >
              {session.status === "open"
                ? "Turno aberto"
                : session.status === "closed"
                  ? "Turno fechado"
                  : "Em fechamento"}
            </span>
          </div>
          <p>
            Aberto em {cashDate(session.opened_at, data.timezone)} · Saldo
            inicial {money(session.initial_balance_cents)}
          </p>
          {session.status === "closed" && (
            <>
              <p>
                Contado: <strong>{money(session.declared_cents ?? 0)}</strong> ·
                Diferença:{" "}
                <strong>{money(session.difference_cents ?? 0)}</strong>
                {session.closed_at &&
                  ` · Fechado em ${cashDate(session.closed_at, data.timezone)}`}
              </p>
              {session.closing_reason && (
                <p>Justificativa: {session.closing_reason}</p>
              )}
            </>
          )}
          <p className="field-hint">
            Recebimentos líquidos incluem todos os meios, descontando estornos.
            Apenas dinheiro, suprimentos e sangrias alteram a gaveta.
          </p>
        </section>
      )}
      <div className="section-heading">
        <div>
          <h2>Movimentações do turno</h2>
          <p className="helper">
            Últimos 100 lançamentos do turno selecionado.
          </p>
        </div>
      </div>
      {data.activity.length ? (
        <div className="stock-table-wrap">
          <table className="stock-table">
            <caption className="sr-only">
              Movimentações do turno de caixa
            </caption>
            <thead>
              <tr>
                <th scope="col">Data</th>
                <th scope="col">Tipo</th>
                <th scope="col">Descrição</th>
                <th scope="col">Valor</th>
              </tr>
            </thead>
            <tbody>
              {data.activity.map((item) => (
                <tr key={item.id}>
                  <td>{cashDate(item.occurred_at, data.timezone)}</td>
                  <td>
                    {activityLabels[item.kind]}
                    {item.method && (
                      <span className="stock-sku">
                        {methodLabels[item.method] ?? item.method}
                      </span>
                    )}
                  </td>
                  <td>
                    {item.reason ||
                      (item.tab_number
                        ? `Comanda ${item.tab_number}`
                        : "Movimentação de caixa")}
                  </td>
                  <td
                    className={
                      item.kind === "refund" || item.kind === "withdrawal"
                        ? "cash-out"
                        : "cash-in"
                    }
                  >
                    {item.kind === "refund" || item.kind === "withdrawal"
                      ? "− "
                      : "+ "}
                    {money(item.amount_cents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty-state">
          <h2>Nenhuma movimentação neste turno</h2>
          <p>Recebimentos, suprimentos e sangrias aparecerão aqui.</p>
        </div>
      )}
    </>
  );
}
