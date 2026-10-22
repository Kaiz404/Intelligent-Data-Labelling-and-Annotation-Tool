/**
 * The workspace in the annotate layout owns rendering; this segment only
 * exists so `/annotate/[imageId]` is a valid URL. Image validation and
 * redirects run client-side once workspace images have loaded.
 */
export default function AnnotateImagePage() {
  return null;
}
