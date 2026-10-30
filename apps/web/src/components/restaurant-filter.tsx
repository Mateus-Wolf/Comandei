import type { Restaurant } from "../lib/api";

export function RestaurantFilter({
  restaurants,
  value,
  onChange,
  disabled = false,
}: {
  restaurants: Pick<Restaurant, "id" | "name">[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  return (
    <label>
      Restaurante
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
      >
        {restaurants.map((restaurant) => (
          <option key={restaurant.id} value={restaurant.id}>
            {restaurant.name}
          </option>
        ))}
      </select>
    </label>
  );
}
