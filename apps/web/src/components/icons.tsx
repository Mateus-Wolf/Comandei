const paths = {
  home: "m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z",
  restaurants: "M4 10v11h16V10M3 4h18l1 6H2l1-6ZM9 21v-7h6v7M8 4v6m8-6v6",
  employees:
    "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z",
  stock: "m3 7 9-4 9 4-9 4-9-4Zm0 0v10l9 4 9-4V7m-9 4v10m-4.5-16 9 4",
  cash: "M3 8h18v13H3V8Zm3 0 2-5h8l2 5M7 12h2m6 0h2m-10 4h10",
  chart: "M3 3v18h18M7 16v-4m5 4V8m5 8V5",
  logout: "M9 4H4v16h5m6-12 4 4-4 4m-9-4h13",
  plus: "M12 5v14M5 12h14",
  table: "M4 5h16v12H4V5Zm0 12v4m16-4v4M8 1v4m8-4v4M1 9h3m-3 5h3m16-5h3m-3 5h3",
};
export function Icon({ name }: { name: keyof typeof paths }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
