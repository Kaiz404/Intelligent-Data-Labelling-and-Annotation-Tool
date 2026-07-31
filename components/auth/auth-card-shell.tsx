import { ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type AuthCardShellProps = {
  children: React.ReactNode;
  className?: string;
};

function AuthPlaceholder() {
  return (
    <div
      className="relative flex size-[150px] items-center justify-center rounded-xl border border-border/60 bg-background"
      style={{
        backgroundImage:
          "radial-gradient(circle, var(--border) 1px, transparent 1px)",
        backgroundSize: "12px 12px",
      }}
    >
      <ImageIcon className="size-10 text-muted-foreground/40" strokeWidth={1.5} />
    </div>
  );
}

export function AuthCardShell({ children, className }: AuthCardShellProps) {
  return (
    <div className={cn("flex flex-col gap-6", className)}>
      <div className="flex overflow-hidden rounded-xl border bg-card shadow-xs">
        <div className="flex flex-1 flex-col gap-6 p-8">{children}</div>
        <div className="hidden flex-1 flex-col items-center justify-center bg-muted p-8 lg:flex">
          <AuthPlaceholder />
        </div>
      </div>
    </div>
  );
}

export function AuthTermsFooter() {
  return (
    <p className="text-center text-xs text-muted-foreground">
      By clicking continue, you agree to our{" "}
      <a href="#" className="underline underline-offset-2">
        Terms of Service
      </a>{" "}
      and{" "}
      <a href="#" className="underline underline-offset-2">
        Privacy Policy
      </a>
      .
    </p>
  );
}

export function AuthDivider() {
  return (
    <div className="flex items-center gap-2">
      <div className="h-px flex-1 bg-border" />
      <span className="text-xs text-muted-foreground">OR CONTINUE WITH</span>
      <div className="h-px flex-1 bg-border" />
    </div>
  );
}
