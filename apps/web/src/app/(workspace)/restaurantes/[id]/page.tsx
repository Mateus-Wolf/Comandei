import RestaurantTablesScreen from "../../../../components/restaurant-tables-screen";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <RestaurantTablesScreen key={id} id={id} />;
}
