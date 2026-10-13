import type { Metadata } from "next";
import { FavoritesView } from "@/components/account/favorites-view";

export const metadata: Metadata = { title: "Your favourites" };

export default function AccountFavoritesPage() {
  return <FavoritesView />;
}
