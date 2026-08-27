"use client";

import { CheckCircle2, ImageIcon, XCircle } from "lucide-react";
import { numberFormatter, toPercent } from "@/lib/format";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

const metricIcons = {
  total: ImageIcon,
  annotated: CheckCircle2,
  unannotated: XCircle
};

type MetricCardsProps = {
  total: number;
  annotated: number;
  unannotated: number;
};

type Metric = {
  id: keyof typeof metricIcons;
  label: string;
  value: number;
  progress?: number;
  progressVariant?: "success" | "destructive";
};

export function MetricCards({
  total,
  annotated,
  unannotated,
}: MetricCardsProps) {
  const metrics: Metric[] = [
    { id: "total" as const, label: "Total Images", value: total },
    {
      id: "annotated" as const,
      label: "Annotated",
      value: annotated,
      progress: toPercent(annotated, total),
      progressVariant: "success" as const,
    },
    {
      id: "unannotated" as const,
      label: "Unannotated",
      value: unannotated,
      progress: toPercent(unannotated, total),
      progressVariant: "destructive" as const,
    },
  ];

  return (
    <div className="grid gap-4 md:grid-cols-3">
      {metrics.map((metric) => {
        const Icon = metricIcons[metric.id];

        return (
          <Card key={metric.id}>
            <CardContent className="p-8">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Icon
                  className={cn(
                    "size-6",
                    metric.id === "annotated" && "text-[#4CAF50]",
                    metric.id === "unannotated" && "text-destructive",
                    metric.id === "total" && "text-primary"
                  )}
                />
                <span className="text-foreground">{metric.label}</span>
              </div>
              <div className="mt-3 flex items-baseline gap-2">
                <span className="text-3xl font-semibold tracking-tight">
                  {numberFormatter.format(metric.value)}
                </span>

                {typeof metric.progress === "number" ? (
                  <div className="ml-2 flex flex-1 items-baseline gap-2">
                    <Progress
                      value={metric.progress}
                      className={cn(
                        "h-2 flex-1",
                        metric.progressVariant === "destructive" &&
                          "[&>div]:bg-destructive",
                        metric.progressVariant === "success" &&
                          "[&>div]:bg-[#4CAF50]"
                      )}
                    />
                    <span className="text-xs text-muted-foreground">
                      {metric.progress}%
                    </span>
                  </div>
                ) : null}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
