export type MetricCard = {
  id: "total" | "annotated" | "unannotated";
  label: string;
  value: number;
  helper?: string;
  progress?: number;
  progressVariant?: "success" | "destructive";
};

export function getDashboardMetrics(): MetricCard[] {
  const totalImages = 11507;
  const annotatedImages = 6769;
  const unannotatedImages = 4738;

  return [
    {
      id: "total",
      label: "Total Images",
      value: totalImages,
      helper: "+12 from last week",
    },
    {
      id: "annotated",
      label: "Annotated",
      value: annotatedImages,
      progress: 70,
      progressVariant: "success",
    },
    {
      id: "unannotated",
      label: "Unannotated",
      value: unannotatedImages,
      progress: 30,
      progressVariant: "destructive",
    },
  ];
}
