import Image from "next/image";
import authLogo from "@/app/auth/auth-logo.png";
import { cn } from "@/lib/utils";

type AuthCardShellProps = {
  children: React.ReactNode;
  className?: string;
};

export function AuthBrand() {
  return (
    <Image
      src={authLogo}
      alt="SmartAnnoTool"
      priority
      className="h-auto w-[180px]"
    />
  );
}
export function AuthCardShell({ children, className }: AuthCardShellProps) {
  return (
    <div
      className={cn(
        "w-full rounded-[10px] border bg-card p-6 shadow-sm",
        className,
      )}
    >
      {children}
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
