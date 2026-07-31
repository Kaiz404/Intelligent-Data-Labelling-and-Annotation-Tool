export type Project = {
  id: string;
  name: string;
  description: string | null;
  starred: boolean;
  created_at: string;
  updated_at: string;
  user_id: string | null;
};

export type ImageStatus = "In Progress" | "Annotated" | "Unannotated";

export type ProjectImage = {
  id: string;
  fileName: string;
  sizeMb: number;
  capturedAt: string;
  status: ImageStatus;
  progress: number;
  thumbnailUrl: string | null;
};

export type UploadStatus = "Uploading" | "Completed" | "Failed";

export type UploadFile = {
  id: string;
  fileName: string;
  sizeMb: number;
  status: UploadStatus;
  progress: number;
};

export type ProjectDraft = {
  name: string;
  description: string;
};
