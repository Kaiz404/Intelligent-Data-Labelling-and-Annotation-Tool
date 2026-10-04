import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const METRICS = ["Total Images", "Annotated", "Unannotated"];
const ROWS = [0, 1, 2];

/** The dashboard's shape (metric cards, Recent Projects table) while it loads. */
export function DashboardSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading dashboard">
      <div className="grid gap-4 md:grid-cols-3">
        {METRICS.map((label, index) => (
          <Card key={label}>
            <CardContent className="p-8">
              <div className="flex items-center gap-2 text-sm">
                <Skeleton className="size-6 rounded-full" />
                <span className="text-foreground">{label}</span>
              </div>
              <div className="mt-3 flex h-9 items-center gap-4">
                <Skeleton className="h-8 w-12" />
                {index > 0 ? <Skeleton className="h-2 flex-1" /> : null}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="overflow-hidden shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 border-b py-4">
          <CardTitle className="text-lg font-semibold">Recent Projects</CardTitle>
          <Skeleton className="h-9 w-32 rounded-md" />
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/70">
                <TableHead>Project Name</TableHead>
                <TableHead className="w-30 text-center">Images</TableHead>
                <TableHead className="w-70">Progress</TableHead>
                <TableHead className="w-50 text-center">Last Modified</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {ROWS.map((row) => (
                <TableRow key={row}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Skeleton className="size-9 rounded-lg" />
                      <Skeleton className="h-4 w-36" />
                    </div>
                  </TableCell>
                  <TableCell><Skeleton className="mx-auto h-4 w-6" /></TableCell>
                  <TableCell><Skeleton className="h-2 w-full" /></TableCell>
                  <TableCell><Skeleton className="mx-auto h-4 w-20" /></TableCell>
                  <TableCell><Skeleton className="size-8 rounded-md" /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="border-t px-6 py-3 text-center">
            <span className="text-sm text-primary">View all projects →</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
