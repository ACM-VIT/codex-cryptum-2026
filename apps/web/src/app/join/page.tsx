"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "../../lib/context";
import { Join } from "../../screens/Overview";
export default function JoinPage() {
  const { session } = useApp();
  const router = useRouter();
  useEffect(() => { if (session) router.replace("/arena"); }, [session, router]);
  return session ? null : <Join />;
}
