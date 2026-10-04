import { Button } from "@/components/ui/button";
import Link from "next/link";

/** Fully static: the proxy sends signed-in visitors to /dashboard. */
export default function Home() {
  return (
    <main className="min-h-screen flex flex-col">
      <nav className="w-full border-b border-b-foreground/10">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-5">
          <Link href="/" className="font-semibold">
            Annotate
          </Link>
          <div className="flex gap-2">
            <Button asChild size="sm" variant="outline">
              <Link href="/auth/login">Sign in</Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/auth/sign-up">Sign up</Link>
            </Button>
          </div>
        </div>
      </nav>

      <div className="flex flex-1 flex-col items-center justify-center gap-6 px-5 py-16 text-center">
        <h1 className="text-3xl font-semibold tracking-tight">
          Image annotation workspace
        </h1>
        <p className="max-w-md text-muted-foreground">
          Organize projects, upload datasets, and annotate images. Sign in to get
          started.
        </p>
        <Button asChild>
          <Link href="/auth/sign-up">Get started</Link>
        </Button>
      </div>
    </main>
  );
}
