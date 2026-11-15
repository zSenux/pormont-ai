import { ClipboardCheck, FileText, PackageCheck, ReceiptEuro, ShoppingCart, Tag, Truck, UserRound, Warehouse, Wrench } from "lucide-react";

// Symbole der Ablauf-Kacheln (als Schlüssel, damit Server-Komponenten sie an die Client-Kachel geben können)
export const ABLAUF_ICONS = {
  kunde: UserRound,
  angebot: Tag,
  ab: ClipboardCheck,
  lieferschein: FileText,
  rechnung: ReceiptEuro,
  artikel: Wrench,
  lager: Warehouse,
  lieferant: Truck,
  bestellung: ShoppingCart,
  eingang: PackageCheck,
} as const;
export type AblaufIcon = keyof typeof ABLAUF_ICONS;
