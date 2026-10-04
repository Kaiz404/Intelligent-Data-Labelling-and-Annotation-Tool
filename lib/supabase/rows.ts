import "server-only";

import type { createClient } from "@/lib/supabase/server";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

// Supabase's default PostgREST max-rows; a lower cap shrinks every page.
const ROW_PAGE_SIZE = 1000;
const PARALLEL_PAGES = 4;

/** Pass to `select(columns, …)` or `rpc(fn, args, …)`: only the first page asks for a count. */
export type CountOption = { count: "exact" } | undefined;

/** A fully ordered PostgREST query (table select or RPC) that still needs its range. */
export type PagedQuery = {
  range(
    from: number,
    to: number,
  ): PromiseLike<{
    data: unknown;
    error: { message: string } | null;
    count: number | null;
  }>;
};

/**
 * Hands every row of a query to `onPage` with the page's offset, one page at
 * a time, in no particular page order. `query` builds a fresh query each call
 * and must order it by a unique column last (so pages never overlap) and pass
 * `count` on. The first page carries the exact row count and the server's
 * real page size, so the rest load in parallel and a max-rows cap below
 * ROW_PAGE_SIZE cannot skip rows. Errors read "Could not load {label}: …"
 * and keep the PostgREST error as `cause`.
 */
export async function forEachQueryPage<Row>(
  label: string,
  query: (count: CountOption) => PagedQuery,
  onPage: (rows: Row[], from: number) => void,
) {
  async function fetchPage(from: number, size: number, withCount = false) {
    const { data, error, count } = await query(
      withCount ? { count: "exact" } : undefined,
    ).range(from, from + size - 1);
    if (error) {
      throw new Error(`Could not load ${label}: ${error.message}`, {
        cause: error,
      });
    }
    return { rows: (data ?? []) as Row[], count };
  }

  const first = await fetchPage(0, ROW_PAGE_SIZE, true);
  onPage(first.rows, 0);
  const pageSize = first.rows.length;
  if (pageSize === 0) return;

  if (first.count == null) {
    // No count: read on until a short page.
    for (let from = pageSize; ; from += pageSize) {
      const { rows } = await fetchPage(from, pageSize);
      onPage(rows, from);
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
        const from = offsets[next++];
        onPage((await fetchPage(from, pageSize)).rows, from);
      }
    }),
  );
}

/** Every row of a query in its own order, paged like {@link forEachQueryPage}. */
export async function fetchAllRows<Row>(
  label: string,
  query: (count: CountOption) => PagedQuery,
): Promise<Row[]> {
  const pages: Array<{ from: number; rows: Row[] }> = [];
  await forEachQueryPage<Row>(label, query, (rows, from) => {
    pages.push({ from, rows });
  });
  return pages.sort((a, b) => a.from - b.from).flatMap((page) => page.rows);
}

/** Every RLS-visible row of `table`, paged like {@link forEachQueryPage}. */
export function forEachRowPage<Row>(
  supabase: SupabaseServerClient,
  table: "projects" | "images" | "recycle_bin_items",
  columns: string,
  onPage: (rows: Row[]) => void,
) {
  return forEachQueryPage<Row>(
    table,
    (count) =>
      supabase.from(table).select(columns, count).order("id", { ascending: true }),
    (rows) => onPage(rows),
  );
}
