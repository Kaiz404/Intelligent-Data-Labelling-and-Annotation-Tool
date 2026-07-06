import { AuthButton } from "@/components/auth-button";
import { ThemeSwitcher } from "@/components/theme-switcher";
import Link from "next/link";
import { Suspense } from "react";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen flex flex-col">
      <nav className="w-full border-b border-b-foreground/10">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-5 text-sm">
          <div className="flex items-center gap-6 font-medium">
            <Link href="/dashboard">Annotate</Link>
            <Link
              href="/projects"
              className="text-muted-foreground hover:text-foreground"
            >
              Projects
            </Link>
          </div>
          <div className="flex items-center gap-4">
            <ThemeSwitcher />
            <Suspense>
              <AuthButton />
            </Suspense>
          </div>
        </div>
      </nav>

      <div className="mx-auto w-full max-w-5xl flex-1 p-5">{children}</div>
    </main>
  );
}
