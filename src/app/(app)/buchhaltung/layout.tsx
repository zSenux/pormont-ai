import { Suspense } from "react";
import { requireArea } from "@/lib/rights";
import { BookTabs } from "./tabs";

export default async function BuchhaltungLayout({ children }: { children: React.ReactNode }) {
  const user = await requireArea("buchhaltung");
  return (
    <div className="mx-auto max-w-6xl space-y-5 px-4 py-6 md:py-10">
      <Suspense>
        <BookTabs admin={user.role === "ADMIN"} />
      </Suspense>
      {children}
    </div>
  );
}
