const UNSPLASH_API = "https://api.unsplash.com";

type UnsplashPhoto = {
  id: string;
  urls: { small: string; regular: string };
};

type UnsplashSearchResponse = {
  results?: UnsplashPhoto[];
};

export async function fetchProjectSamplePhotos(
  query: string,
  count = 12,
): Promise<{ photos: UnsplashPhoto[]; error: string | null }> {
  const accessKey = process.env.UNSPLASH_ACCESS_KEY;

  if (!accessKey) {
    return { photos: [], error: "Unsplash access key is not configured." };
  }

  const headers = { Authorization: `Client-ID ${accessKey}` };
  const searchQuery = encodeURIComponent(query.trim() || "urban street");

  try {
    const searchResponse = await fetch(
      `${UNSPLASH_API}/search/photos?query=${searchQuery}&per_page=${count}`,
      { headers, next: { revalidate: 3600 } },
    );

    if (searchResponse.ok) {
      const data = (await searchResponse.json()) as UnsplashSearchResponse;
      if (data.results?.length) {
        return { photos: data.results.slice(0, count), error: null };
      }
    }

    const randomResponse = await fetch(
      `${UNSPLASH_API}/photos/random?count=${count}`,
      { headers, next: { revalidate: 3600 } },
    );

    if (!randomResponse.ok) {
      return {
        photos: [],
        error: "Failed to fetch sample images from Unsplash.",
      };
    }

    const randomPhotos = (await randomResponse.json()) as UnsplashPhoto[];
    return {
      photos: Array.isArray(randomPhotos)
        ? randomPhotos.slice(0, count)
        : [randomPhotos],
      error: null,
    };
  } catch {
    return {
      photos: [],
      error: "Failed to fetch sample images from Unsplash.",
    };
  }
}
