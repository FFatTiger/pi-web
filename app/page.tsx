import { Suspense } from "react";
import { AppShell } from "@/components/AppShell";

export const dynamic = "force-dynamic";

export default function Home() {
  return (
    <Suspense>
      <AppShell />
    </Suspense>
  );
}
