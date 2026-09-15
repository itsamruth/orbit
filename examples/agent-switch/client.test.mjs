import assert from "node:assert/strict";
import { setTimeout } from "node:timers/promises";
import test from "node:test";
import { createClient } from "./client.mjs";

test("successful requests do not refresh", async () => {
  let refreshes = 0;
  const request = createClient({
    send: async () => ({ status: 200 }),
    refresh: async () => { refreshes++; },
  });
  assert.equal((await request("/profile")).status, 200);
  assert.equal(refreshes, 0);
});

test("concurrent 401s share one refresh", async () => {
  let refreshes = 0;
  const attempts = new Map();
  const request = createClient({
    send: async (path) => {
      const attempt = (attempts.get(path) ?? 0) + 1;
      attempts.set(path, attempt);
      return { status: attempt === 1 ? 401 : 200 };
    },
    refresh: async () => { refreshes++; await setTimeout(10); },
  });
  const responses = await Promise.all([request("/profile"), request("/settings")]);
  assert.deepEqual(responses.map((response) => response.status), [200, 200]);
  assert.equal(refreshes, 1, "concurrent requests must share a refresh");
});

test("a failed refresh does not block later recovery", async () => {
  let calls = 0;
  let refreshes = 0;
  const request = createClient({
    send: async () => ({ status: ++calls < 3 ? 401 : 200 }),
    refresh: async () => {
      if (++refreshes === 1) throw new Error("refresh unavailable");
    },
  });
  await assert.rejects(request("/profile"), /refresh unavailable/);
  assert.equal((await request("/profile")).status, 200);
  assert.equal(refreshes, 2);
});
