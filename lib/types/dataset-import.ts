/** Source-local identifiers, never Supabase IDs. */
export type DatasetCategory = { id: string; name: string };

export type DatasetBox = {
  id: string;
  categoryId: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type DatasetImage = {
  id: string;
  /** Normalized, case-sensitive path from the annotation document. */
  path: string;
  width: number;
  height: number;
  boxes: DatasetBox[];
};

/** Parser output: geometry validated, source files not yet verified. */
export type DatasetImportPlan = {
  categories: DatasetCategory[];
  images: DatasetImage[];
};

/** ZIP output: every referenced file has been matched and decoded. */
export type ValidatedDatasetImportPlan = Omit<DatasetImportPlan, "images"> & {
  annotationPath: string;
  images: Array<DatasetImage & { archivePath: string; file: File }>;
};
