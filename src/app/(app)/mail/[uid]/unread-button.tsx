"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { MailOpen } from "lucide-react";
import { markMail } from "@/app/actions";

export function UnreadButton({ uid }: { uid: number }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <button
      className="btn-secondary"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await markMail(uid, false);
          router.push("/mail");
        })
      }
    >
      <MailOpen className="size-4" /> Als ungelesen
    </button>
  );
}
