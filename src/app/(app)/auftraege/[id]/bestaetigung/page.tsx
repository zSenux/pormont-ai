import { requireUser } from "@/lib/auth/user";
import { OrderDoc } from "@/components/order-doc";

export const dynamic = "force-dynamic";
export const metadata = { title: "Auftragsbestätigung" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  return <OrderDoc id={(await params).id} kind="bestaetigung" />;
}
