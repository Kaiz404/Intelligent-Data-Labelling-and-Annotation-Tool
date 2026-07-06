import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";

async function DashboardStats() {
  await connection();
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("projects")
    .select("*", { count: "exact", head: true });

  const projectCount = error ? 0 : (count ?? 0);

  return (
    <Card className="max-w-sm">
      <CardHeader>
        <CardTitle>Projects</CardTitle>
        <CardDescription>
          You have {projectCount} project{projectCount === 1 ? "" : "s"}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button asChild variant="outline">
          <Link href="/projects">View projects</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

export default function DashboardPage() {
  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-muted-foreground">Overview of your workspace</p>
      </div>

      <Suspense fallback={<p className="text-muted-foreground">Loading...</p>}>
        <DashboardStats />
      </Suspense>
    </div>
  );
}
