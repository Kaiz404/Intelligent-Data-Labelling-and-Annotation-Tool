import type { ImageStatus, ProjectImage } from "@/lib/types/projects";
import type { UploadQueueItem } from "@/lib/uploads/types";

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
    const thumbnailUrl = unsplashError
      ? null
      : (photo?.urls?.small ?? photo?.urls?.regular ?? null);
    const imageUrl = unsplashError
      ? null
      : (photo?.urls?.regular ?? photo?.urls?.small ?? null);

    return {
      id: `image-${index + 1}`,
      fileName: `street_${String(index + 1).padStart(4, "0")}.jpg`,
      sizeMb: [2.4, 1.8, 4.9, 6.1][index % 4],
      capturedAt: "July 20, 2026 10:30 AM",
      status,
      progress: statusProgress[status],
      thumbnailUrl,
      imageUrl,
    };
  });
}

/** Demo seed for the upload modal (no File handles — re-add files to actually upload). */
export const MOCK_UPLOAD_FILES: UploadQueueItem[] = [
  {
    id: "upload-1",
    fileName: "street_0001.jpg",
    sizeBytes: 2.4 * 1024 * 1024,
    mimeType: "image/jpeg",
    status: "Uploading",
    progress: 64,
  },
  {
    id: "upload-2",
    fileName: "street_0002.jpg",
    sizeBytes: 1.8 * 1024 * 1024,
    mimeType: "image/jpeg",
    status: "Completed",
    progress: 100,
  },
  {
    id: "upload-3",
    fileName: "street_0003.jpg",
    sizeBytes: 4.9 * 1024 * 1024,
    mimeType: "image/jpeg",
    status: "Uploading",
    progress: 80,
  },
  {
    id: "upload-4",
    fileName: "street_0004.jpg",
    sizeBytes: 6.1 * 1024 * 1024,
    mimeType: "image/jpeg",
    status: "Failed",
    progress: 18,
    error: "Simulated chunk upload failure",
  },
  {
    id: "upload-5",
    fileName: "street_0005.jpg",
    sizeBytes: 3.6 * 1024 * 1024,
    mimeType: "image/jpeg",
    status: "Completed",
    progress: 100,
  },
  {
    id: "upload-6",
    fileName: "street_0006.jpg",
    sizeBytes: 12 * 1024 * 1024,
    mimeType: "image/jpeg",
    status: "Uploading",
    progress: 90,
  },
];
