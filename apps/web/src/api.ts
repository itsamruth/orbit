import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  if (
    init?.method &&
    init.method !== "GET" &&
    path.startsWith("/projects/") &&
    new URLSearchParams(window.location.search).has("revision")
  )
    throw new ApiError(
      409,
      "Historical revisions are read only. Return to a branch to edit.",
    );
  path = revisionPath(path, init?.method);
  const response = await fetch("/api/v1" + path, {
    credentials: "same-origin",
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new ApiError(
      response.status,
      body.message ?? "The request failed. Please try again.",
    );
  return body as T;
}
export function useApi<T>(path: string, enabled = true) {
  return useQuery<T>({
    queryKey: [revisionPath(path)],
    queryFn: () => request<T>(path),
    enabled,
    retry: (count, e) =>
      !(e instanceof ApiError && e.status < 500) && count < 2,
    refetchInterval: 10000,
  });
}
export function useWrite() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      path,
      method = "PATCH",
      body,
    }: {
      path: string;
      method?: string;
      body?: unknown;
    }) =>
      request(path, {
        method,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      }),
    onSuccess: () => {
      void client.invalidateQueries();
    },
  });
}

export function useCollection<T>(path: string) {
  return useQuery<{ items: T[]; nextCursor: null }>({
    queryKey: [revisionPath(path)],
    retry: (count, e) =>
      !(e instanceof ApiError && e.status < 500) && count < 2,
    queryFn: async () => {
      const items: T[] = [];
      let cursor: string | null = null;
      const seen = new Set<string>();
      do {
        const data: { items: T[]; nextCursor: string | null } = await request<{
          items: T[];
          nextCursor: string | null;
        }>(
          path +
            (cursor
              ? (path.includes("?") ? "&cursor=" : "?cursor=") +
                encodeURIComponent(cursor)
              : ""),
        );
        items.push(...data.items);
        cursor = data.nextCursor;
        if (cursor) {
          if (seen.has(cursor)) throw new Error("Invalid pagination cursor");
          seen.add(cursor);
        }
      } while (cursor);
      return { items, nextCursor: null };
    },
    refetchInterval: 10000,
  });
}

export function revisionPath(path: string, method = "GET") {
  if (!path.startsWith("/projects/")) return path;
  const current = new URLSearchParams(window.location.search);
  const url = new URL(path, window.location.origin);
  const revision = current.get("revision") ?? current.get("branch");
  if (method === "GET" && revision && !url.searchParams.has("revision"))
    url.searchParams.set("revision", revision);
  if (method !== "GET" && current.get("branch"))
    url.searchParams.set("branch", current.get("branch")!);
  return url.pathname + url.search;
}
