"use client";
import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useApp } from "../../../lib/context";
import { Arena } from "../../../screens/Arena";
export default function ArenaPage() {
  const { session } = useApp();
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => { if (!session) router.replace(`/join?from=${encodeURIComponent(pathname)}`); }, [session, router, pathname]);
  return session ? <Arena /> : null;
}
