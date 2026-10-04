import "server-only";

import type { createClient } from "@/lib/supabase/server";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

// Supabase's default PostgREST max-rows; a lower cap shrinks every page.
const ROW_PAGE_SIZE = 1000;
const PARALLEL_PAGES = 4;

/**
 * Hands every RLS-visible row of `table` to `onPage`, one page at a time, in
 * no particular page order. The first page carries the exact row count and
 * the server's real page size, so the rest load in parallel and a max-rows
 * cap below ROW_PAGE_SIZE cannot skip rows. Errors keep the PostgREST error
 * as `cause`.
 */
export async function forEachRowPage<Row>(
  supabase: SupabaseServerClient,
  table: "projects" | "images" | "recycle_bin_items",
  columns: string,
  onPage: (rows: Row[]) => void,
) {
  async function fetchPage(from: number, size: number, withCount = false) {
    const { data, error, count } = await supabase
      .from(table)
      .select(columns, withCount ? { count: "exact" } : undefined)
      .order("id", { ascending: true })
      .range(from, from + size - 1);
    if (error) {
      throw new Error(`Could not load ${table}: ${error.message}`, {
        cause: error,
      });
    }
    return { rows: (data ?? []) as unknown as Row[], count };
  }

  const first = await fetchPage(0, ROW_PAGE_SIZE, true);
  onPage(first.rows);
  const pageSize = first.rows.length;
  if (pageSize === 0) return;

  if (first.count == null) {
    // No count: read on until a short page.
    for (let from = pageSize; ; from += pageSize) {
      const { rows } = await fetchPage(from, pageSize);
      onPage(rows);
      if (rows.length < pageSize) return;
    }
  }

  const offsets: number[] = [];
  for (let from = pageSize; from < first.count; from += pageSize) {
    offsets.push(from);
  }
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(PARALLEL_PAGES, offsets.length) }, async () => {
      while (next < offsets.length) {
        onPage((await fetchPage(offsets[next++], pageSize)).rows);
      }
    }),
  );
}
