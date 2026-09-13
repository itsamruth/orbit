import { setupWorker } from "msw/browser";
import { http, HttpResponse, delay } from "msw";
import {
  me,
  projects,
  workstreams,
  sessions,
  events,
  devices,
  checkpoints,
} from "./data";
const scenario = new URLSearchParams(window.location.search).get("scenario");
const page = (items: unknown[]) =>
  HttpResponse.json({ items, nextCursor: null });
const missing = () =>
  HttpResponse.json(
    { message: "This history does not exist." },
    { status: 404 },
  );
export const worker = setupWorker(
  http.all("/api/v1/*", async ({ request }) => {
    await delay(100);
    const url = new URL(request.url);
    const parts = url.pathname.replace("/api/v1/", "").split("/");
    const method = request.method;
    if (parts[0] === "me")
      return scenario === "expired"
        ? HttpResponse.json({ message: "Session expired" }, { status: 401 })
        : HttpResponse.json(me);
    if (parts[0] === "auth")
      return parts[1] === "config"
        ? HttpResponse.json({
            mode: "local",
            origin: window.location.origin,
            email: true,
            github: false,
          })
        : HttpResponse.json({ ok: true });
    if (parts[0] === "devices") {
      if (method === "DELETE") {
        const i = devices.findIndex((d) => d.id === parts[1]);
        if (i >= 0) devices.splice(i, 1);
        return HttpResponse.json({ ok: true });
      }
      return page(devices);
    }
    if (parts[0] !== "projects") return missing();
    if (scenario === "error")
      return HttpResponse.json(
        { message: "Demo server unavailable" },
        { status: 503 },
      );
    if (!parts[1]) return page(scenario === "empty" ? [] : projects);
    const p = projects.find((p) => p.id === parts[1]);
    if (!p) return missing();
    if (!parts[2]) {
      if (method === "PATCH") {
        Object.assign(p, await request.json());
        return HttpResponse.json(p);
      }
      if (method === "DELETE") {
        projects.splice(projects.indexOf(p), 1);
        return HttpResponse.json({ ok: true });
      }
      return HttpResponse.json(p);
    }
    if (parts[2] === "checkpoints") return page(checkpoints);
    if (parts[2] === "compare") {
      const [from, to] = [
        url.searchParams.get("from"),
        url.searchParams.get("to"),
      ];
      return HttpResponse.json({
        from,
        to,
        changes: [
          {
            id: "evt_demo_compare",
            kind: "event",
            action: "put",
            before: null,
            after: {
              payload: {
                type: "assistant_message",
                text: "The viewer now renders normalized events in session order.",
              },
            },
          },
        ],
      });
    }
    if (parts[2] !== "workstreams" && parts[2] !== "sessions") return missing();
    const collection = parts[2] === "workstreams" ? workstreams : sessions;
    if (!parts[3]) return page(collection.filter((x) => x.projectId === p.id));
    if (parts[4] === "events") {
      const matching = events.filter(
        (e) => e.projectId === p.id && e.sessionId === parts[3],
      );
      if (scenario === "long" && matching[0]) {
        const first = matching[0];
        for (let i = matching.length; i < 120; i++)
          matching.push({
            ...first,
            id: "evt_long_" + i,
            sequence: i,
            payload: {
              type: "assistant_message",
              text: "Additional captured event " + i,
            },
          });
      }
      const offset = Number(url.searchParams.get("cursor") ?? 0);
      return HttpResponse.json({
        items: matching.slice(offset, offset + 50),
        nextCursor: offset + 50 < matching.length ? String(offset + 50) : null,
      });
    }
    const item = collection.find(
      (x) => x.id === parts[3] && x.projectId === p.id,
    );
    if (!item) return missing();
    if (method === "PATCH") {
      Object.assign(item, await request.json());
      return HttpResponse.json(item);
    }
    if (method === "DELETE") {
      collection.splice(
        collection.findIndex((x) => x.id === item.id),
        1,
      );
      return HttpResponse.json({ ok: true });
    }
    return HttpResponse.json(item);
  }),
);
