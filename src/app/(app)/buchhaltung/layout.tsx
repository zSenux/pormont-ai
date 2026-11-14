import { Suspense } from "react";
import { requireUser } from "@/lib/auth/user";
import { BookTabs } from "./tabs";

export default async function BuchhaltungLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <div className="mx-auto max-w-6xl space-y-5 px-4 py-6 md:py-10">
      <Suspense>
        <BookTabs admin={user.role === "ADMIN"} />
      </Suspense>
      {children}
    </div>
  );
}
