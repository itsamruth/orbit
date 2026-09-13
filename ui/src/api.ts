import { useQuery } from "@tanstack/react-query";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function revisionPath(path: string) {
  if (!path.startsWith("/projects/")) return path;
  const current = new URLSearchParams(window.location.search);
  const revision = current.get("revision") ?? current.get("branch");
  const url = new URL(path, window.location.origin);
  if (revision && !url.searchParams.has("revision"))
    url.searchParams.set("revision", revision);
  return url.pathname + url.search;
}

export async function request<T>(path: string): Promise<T> {
  const response = await fetch("/api/v1" + revisionPath(path), {
    cache: "no-store",
  });
  const body = await response.json();
  if (!response.ok)
    throw new ApiError(
      response.status,
      body.message ?? "Could not read local history",
    );
  return body as T;
}

export function useApi<T>(path: string, enabled = true) {
  return useQuery<T>({
    queryKey: ["resource", revisionPath(path)],
    queryFn: () => request<T>(path),
    enabled,
    retry: 1,
    refetchInterval: 2000,
  });
}

export function useCollection<T>(path: string) {
  return useQuery({
    queryKey: ["collection", revisionPath(path)],
    retry: 1,
    refetchInterval: 2000,
    queryFn: async () => {
      const items: T[] = [],
        unavailable: { projectId: string; message: string }[] = [];
      const seen = new Set<string>();
      let cursor: string | null = null;
      do {
        const page: {
          items: T[];
          nextCursor: string | null;
          unavailable?: typeof unavailable;
        } = await request(
          path +
            (cursor
              ? (path.includes("?") ? "&" : "?") +
                "cursor=" +
                encodeURIComponent(cursor)
              : ""),
        );
        items.push(...page.items);
        unavailable.push(...(page.unavailable ?? []));
        cursor = page.nextCursor;
        if (cursor && seen.has(cursor))
          throw new Error("Invalid history page cursor");
        if (cursor) seen.add(cursor);
      } while (cursor);
      return {
        items,
        unavailable: [
          ...new Map(
            unavailable.map((item) => [item.projectId, item]),
          ).values(),
        ],
      };
    },
  });
}
