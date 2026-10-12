import type { Metadata } from "next";
import { ListsView } from "@/components/account/lists-view";

export const metadata: Metadata = { title: "Shopping lists" };

export default function AccountListsPage() {
  return <ListsView />;
}
