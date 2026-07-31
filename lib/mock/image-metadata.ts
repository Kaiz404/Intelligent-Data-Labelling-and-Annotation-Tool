import type { ImageStatus, ProjectImage } from "@/lib/types/projects";

const statusPattern: ImageStatus[] = [
  "In Progress",
  "Annotated",
  "Unannotated",
  "In Progress",
];

const statusProgress: Record<ImageStatus, number> = {
  "In Progress": 48,
  Annotated: 100,
  Unannotated: 0,
};

type UnsplashPhoto = {
  urls?: { small?: string; regular?: string };
};

export function buildProjectImages(
  count: number,
  photos: UnsplashPhoto[],
  unsplashError: string | null,
): ProjectImage[] {
  return Array.from({ length: count }, (_, index) => {
    const status = statusPattern[index % statusPattern.length];
    const photo = photos[index];
    const thumbnailUrl =
      unsplashError
        ? null
        : (photo?.urls?.small ?? photo?.urls?.regular ?? null);

    return {
      id: `image-${index + 1}`,
      fileName: `street_${String(index + 1).padStart(4, "0")}.jpg`,
      sizeMb: [2.4, 1.8, 4.9, 6.1][index % 4],
      capturedAt: "July 20, 2026 10:30 AM",
      status,
      progress: statusProgress[status],
      thumbnailUrl,
    };
  });
}

export const MOCK_UPLOAD_FILES = [
  {
    id: "upload-1",
    fileName: "street_0001.jpg",
    sizeMb: 2.4,
    status: "Uploading" as const,
    progress: 64,
  },
  {
    id: "upload-2",
    fileName: "street_0002.jpg",
    sizeMb: 1.8,
    status: "Completed" as const,
    progress: 100,
  },
  {
    id: "upload-3",
    fileName: "street_0003.jpg",
    sizeMb: 4.9,
    status: "Uploading" as const,
    progress: 80,
  },
  {
    id: "upload-4",
    fileName: "street_0004.jpg",
    sizeMb: 6.1,
    status: "Failed" as const,
    progress: 18,
  },
  {
    id: "upload-5",
    fileName: "street_0005.jpg",
    sizeMb: 3.6,
    status: "Completed" as const,
    progress: 100,
  },
  {
    id: "upload-6",
    fileName: "street_0006.jpg",
    sizeMb: 12,
    status: "Uploading" as const,
    progress: 90,
  },
];
