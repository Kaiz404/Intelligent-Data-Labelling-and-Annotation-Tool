"use client";

import { CheckCircle2, ImageIcon, XCircle } from "lucide-react";
import { getDashboardMetrics } from "@/lib/mock/dashboard-metrics";
import { numberFormatter } from "@/lib/format";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

const metricIcons = {
  total: ImageIcon,
  annotated: CheckCircle2,
  unannotated: XCircle,
};

export function MetricCards() {
  const metrics = getDashboardMetrics();

  return (
    <div className="grid gap-4 md:grid-cols-3">
      {metrics.map((metric) => {
        const Icon = metricIcons[metric.id];

        return (
          <Card key={metric.id}>
            <CardContent className="p-5">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Icon
                  className={cn(
                    "size-4",
                    metric.id === "annotated" && "text-emerald-600",
                    metric.id === "unannotated" && "text-destructive",
                    metric.id === "total" && "text-primary",
                  )}
                />
                <span>{metric.label}</span>
              </div>
              <div className="mt-3 flex items-baseline gap-2">
                <span className="text-3xl font-semibold tracking-tight">
                  {numberFormatter.format(metric.value)}
                </span>
                {metric.helper ? (
                  <span className="text-xs text-emerald-600">{metric.helper}</span>
                ) : null}
              </div>
              {typeof metric.progress === "number" ? (
                <div className="mt-4 flex items-center gap-3">
                  <Progress
                    value={metric.progress}
                    className={cn(
                      "h-2",
                      metric.progressVariant === "destructive" &&
                        "[&>div]:bg-destructive",
                      metric.progressVariant === "success" &&
                        "[&>div]:bg-emerald-500",
                    )}
                  />
                  <span className="text-xs text-muted-foreground">
                    {metric.progress}%
                  </span>
                </div>
              ) : null}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
