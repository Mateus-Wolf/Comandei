"use client";
import { useId, useState } from "react";
import { financialDate, type FinancialDay } from "../lib/financial";
import { money } from "../lib/cash";

export function FinancialTrend({ days }: { days: FinancialDay[] }) {
  const id = useId();
  const [metric, setMetric] = useState<"net_received_cents" | "sales_cents">(
    "net_received_cents",
  );
  const label =
    metric === "sales_cents" ? "Vendas fechadas" : "Recebimentos líquidos";
  const values = days.map((day) => day[metric]);
  const maximum = Math.max(100, ...values);
  const minimum = Math.min(0, ...values);
  const y = (value: number) =>
    24 + ((maximum - value) / (maximum - minimum)) * 164;
  const x = (index: number) =>
    days.length === 1 ? 395 : 82 + (index / (days.length - 1)) * 618;
  const points = values
    .map((value, index) => `${x(index)},${y(value)}`)
    .join(" ");
  const area = `${x(0)},${y(0)} ${points} ${x(days.length - 1)},${y(0)}`;
  const peak = days.reduce(
    (best, day) => (day[metric] > best[metric] ? day : best),
    days[0],
  );
  return (
    <section
      className="financial-panel financial-trend"
      aria-labelledby={`${id}-heading`}
    >
      <div className="financial-panel-heading">
        <div>
          <span className="eyebrow">DIA A DIA</span>
          <h2 id={`${id}-heading`}>Evolução do período</h2>
        </div>
        <label className="financial-chart-select">
          <span className="sr-only">Indicador do gráfico</span>
          <select
            value={metric}
            onChange={(event) => setMetric(event.target.value as typeof metric)}
          >
            <option value="net_received_cents">Recebimentos líquidos</option>
            <option value="sales_cents">Vendas fechadas</option>
          </select>
        </label>
      </div>
      <svg
        className="financial-line-chart"
        viewBox="0 0 730 232"
        role="img"
        aria-labelledby={`${id}-title ${id}-desc`}
      >
        <title id={`${id}-title`}>{label} por dia</title>
        <desc id={`${id}-desc`}>
          Valores em reais. Consulte os valores de cada dia no detalhamento
          abaixo.
        </desc>
        <defs>
          <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#236350" stopOpacity="0.2" />
            <stop offset="100%" stopColor="#236350" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {[0, 1, 2, 3].map((tick) => {
          const value = maximum - ((maximum - minimum) * tick) / 3;
          return (
            <g key={tick}>
              <line
                x1="82"
                x2="700"
                y1={y(value)}
                y2={y(value)}
                stroke="#d4ded8"
                strokeDasharray="3 5"
              />
              <text
                x="70"
                y={y(value) + 4}
                textAnchor="end"
                className="financial-chart-label"
              >
                {new Intl.NumberFormat("pt-BR", {
                  notation: "compact",
                  maximumFractionDigits: 1,
                }).format(value / 100)}
              </text>
            </g>
          );
        })}
        {minimum < 0 && (
          <line x1="82" x2="700" y1={y(0)} y2={y(0)} stroke="#52655f" />
        )}
        <polygon points={area} fill={`url(#${id}-fill)`} />
        <polyline
          points={points}
          fill="none"
          stroke="#236350"
          strokeWidth="3"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {days.map((day, index) => (
          <g key={day.business_date}>
            <circle
              cx={x(index)}
              cy={y(day[metric])}
              r={days.length > 15 ? 3 : 4}
              fill="#236350"
              stroke="white"
              strokeWidth="2"
            >
              <title>
                {financialDate(day.business_date)}: {money(day[metric])}
              </title>
            </circle>
            {(index === 0 ||
              index === days.length - 1 ||
              index % Math.max(1, Math.ceil(days.length / 6)) === 0) && (
              <text
                x={x(index)}
                y="218"
                textAnchor="middle"
                className="financial-chart-label"
              >
                {financialDate(day.business_date, true)}
              </text>
            )}
          </g>
        ))}
      </svg>
      <div className="financial-chart-footer">
        <span>
          <i aria-hidden="true" />
          {label} · R$
        </span>
        {peak && peak[metric] > 0 && (
          <span>
            Maior valor:{" "}
            <strong>
              {financialDate(peak.business_date, true)} · {money(peak[metric])}
            </strong>
          </span>
        )}
      </div>
    </section>
  );
}
