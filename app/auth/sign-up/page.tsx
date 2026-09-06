import { SignUpForm } from "@/components/sign-up-form";

export default function Page() {
  return (
    <div className="flex min-h-svh w-full items-center justify-center bg-[#f7f7f9] p-6 dark:bg-background">
      <div className="w-full max-w-[380px]">
        <SignUpForm />
      </div>
    </div>
  );
}
