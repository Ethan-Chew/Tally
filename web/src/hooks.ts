import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, qs, type AccountsResponse, type Category, type EntriesResponse, type Me, type Named } from "./api";

export const useMe = () => useQuery({ queryKey: ["me"], queryFn: () => api<{ user: Me }>("/api/me").then((r) => r.user), retry: false, staleTime: 60_000 });
export const useAccounts = () => useQuery({ queryKey: ["accounts"], queryFn: () => api<AccountsResponse>("/api/accounts") });
export const useCategories = () => useQuery({ queryKey: ["categories"], queryFn: () => api<Category[]>("/api/categories") });
export const useMerchants = () => useQuery({ queryKey: ["merchants"], queryFn: () => api<Named[]>("/api/merchants") });
export const useTags = () => useQuery({ queryKey: ["tags"], queryFn: () => api<Named[]>("/api/tags") });

/** A mutation that refreshes every query on success: the data is small and everything is derived from the same rows. */
export function useAction<TVars = void, TOut = unknown>(fn: (v: TVars) => Promise<TOut>, onDone?: (out: TOut) => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async (out) => {
      await qc.invalidateQueries();
      onDone?.(out);
    },
  });
}

/** Entries that load as you scroll. Totals come with the first page only, so later pages are cheap. */
export function useEntries(params: Record<string, string | number | undefined | null>, perPage = 30) {
  const q = useInfiniteQuery({
    queryKey: ["entries", params, perPage],
    initialPageParam: 1,
    queryFn: ({ pageParam }) => api<EntriesResponse>(`/api/entries${qs({ ...params, page: pageParam, per_page: perPage })}`),
    getNextPageParam: (_last, all) => (all.length * perPage < (all[0]?.total ?? 0) ? all.length + 1 : undefined),
    placeholderData: keepPreviousData,
  });
  const first = q.data?.pages[0];
  return {
    rows: q.data?.pages.flatMap((p) => p.rows) ?? [],
    total: first?.total ?? 0,
    income: first?.income ?? 0,
    expense: first?.expense ?? 0,
    currency: first?.currency ?? "",
    loaded: !!q.data,
    isFetching: q.isFetching,
    isFetchingNextPage: q.isFetchingNextPage,
    hasMore: !!q.hasNextPage,
    loadMore: () => { if (q.hasNextPage && !q.isFetchingNextPage) q.fetchNextPage(); },
  };
}
