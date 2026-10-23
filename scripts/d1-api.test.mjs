import assert from "node:assert/strict";
import test from "node:test";
import { onRequest } from "../functions/api/[[path]].js";
import { ApiError, makeSessionToken } from "../functions/_lib/auth.js";
import { loadAppState, validDate, validateGathering } from "../functions/_lib/db.js";

class FakeStatement {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql;
    this.values = [];
  }

  bind(...values) {
    this.values = values;
    return this;
  }

  async first() {
    if (this.sql.includes("FROM app_users")) return this.db.user;
    if (this.sql.includes("COUNT(*) AS count FROM seasons")) return { count: 1 };
    if (this.sql.includes("FROM seasons WHERE is_current")) return { id: 1, name: "Season 1" };
    return null;
  }

  async all() {
    if (this.sql.includes("FROM members WHERE is_active")) return { results: ["s", "a", "j", "n", "i"].map((id) => ({ id })) };
    return { results: [] };
  }

  async run() {
    this.db.runs++;
    return { success: true, meta: { changes: 1 } };
  }
}

class FakeDatabase {
  constructor(user) {
    this.user = user;
    this.runs = 0;
    this.batches = 0;
  }

  prepare(sql) {
    return new FakeStatement(this, sql);
  }

  async batch(statements) {
    this.batches++;
    this.batchSize = statements.length;
    return [{ results: [{ id: 23 }], meta: { last_row_id: 23 } }];
  }
}

const env = (DB) => ({
  DB,
  DISCORD_CLIENT_ID: "client-id",
  DISCORD_CLIENT_SECRET: "client-secret",
  SESSION_SECRET: "0123456789abcdef0123456789abcdef",
  ADMIN_DISCORD_ID: "admin-discord-id"
});

test("a member session cannot write to the live season", async () => {
  const db = new FakeDatabase({ discord_id: "member-discord-id", member_id: "a", is_admin: 0, member_name: "Adam" });
  const token = await makeSessionToken("member-discord-id", env(db).SESSION_SECRET);
  const request = new Request("https://brotime-attend.pages.dev/api/seasons", {
    method: "POST",
    headers: {
      cookie: "brotime_session=" + token,
      origin: "https://brotime-attend.pages.dev"
    }
  });
  const response = await onRequest({ request, env: env(db) });
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "Administrator access is required." });
  assert.equal(db.batches, 0);
  assert.equal(db.runs, 0);
});

test("the configured administrator can start a season", async () => {
  const db = new FakeDatabase({ discord_id: "admin-discord-id", member_id: null, is_admin: 1, member_name: null });
  const token = await makeSessionToken("admin-discord-id", env(db).SESSION_SECRET);
  const request = new Request("https://brotime-attend.pages.dev/api/seasons", {
    method: "POST",
    headers: {
      cookie: "brotime_session=" + token,
      origin: "https://brotime-attend.pages.dev"
    }
  });
  const response = await onRequest({ request, env: env(db) });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, message: "Season 2 started." });
  assert.equal(db.batches, 1);
});

test("an administrator records a gathering and all five attendance rows together", async () => {
  const db = new FakeDatabase({ discord_id: "admin-discord-id", member_id: null, is_admin: 1, member_name: null });
  const token = await makeSessionToken("admin-discord-id", env(db).SESSION_SECRET);
  const request = new Request("https://brotime-attend.pages.dev/api/gatherings", {
    method: "POST",
    headers: {
      cookie: "brotime_session=" + token,
      origin: "https://brotime-attend.pages.dev",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      date: "2026-10-23",
      activity: "Poker",
      notes: "",
      attendance: { s: true, a: false, j: true, n: true, i: false }
    })
  });
  const response = await onRequest({ request, env: env(db) });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, id: 23, message: "Gathering saved." });
  assert.equal(db.batches, 1);
  assert.equal(db.batchSize, 6);
});

test("gathering validation accepts complete attendance and rejects impossible dates", () => {
  const memberIds = ["s", "a", "j", "n", "i"];
  const form = { date: "2026-10-23", activity: "  Poker  ", notes: "  weekly game  ", attendance: { s: true, a: false, j: true, n: true, i: false } };
  assert.equal(validDate("2026-10-23"), true);
  assert.equal(validDate("2026-02-30"), false);
  assert.deepEqual(validateGathering(form, memberIds), {
    date: "2026-10-23",
    activity: "Poker",
    notes: "weekly game",
    attendance: { s: true, a: false, j: true, n: true, i: false }
  });
  assert.throws(() => validateGathering({ ...form, date: "2026-02-30" }, memberIds), (error) => error instanceof ApiError && error.status === 400);
  assert.throws(() => validateGathering({ ...form, attendance: { s: true } }, memberIds), (error) => error instanceof ApiError && error.status === 400);
});

test("D1 state loading groups attendance and payment dates into the app data shape", async () => {
  const members = ["s", "a", "j", "n", "i"].map((id, index) => ({ id, name: ["Sterling", "Adam", "Julian", "Nathan", "Isaiah"][index] }));
  const rows = [
    { id: 20, season_id: 1, date: "2026-10-23", activity: "Poker", notes: "", member_id: "s", present: 1 },
    { id: 20, season_id: 1, date: "2026-10-23", activity: "Poker", notes: "", member_id: "a", present: 0 },
    { id: 20, season_id: 1, date: "2026-10-23", activity: "Poker", notes: "", member_id: "j", present: 1 }
  ];
  const db = {
    prepare(sql) {
      return {
        all: async () => {
          if (sql.includes("FROM seasons")) return { results: [{ id: 1, name: "Season 1", closed: 0, imported: 0, is_current: 1 }] };
          if (sql.includes("FROM members")) return { results: members };
          if (sql.includes("FROM gatherings")) return { results: rows };
          if (sql.includes("FROM beer_payments")) return { results: [{ season_id: 1, member_id: "a", paid_on: "2026-10-24" }] };
          return { results: [] };
        }
      };
    }
  };
  const state = await loadAppState(db);
  assert.equal(state.currentSeasonId, 1);
  assert.equal(state.seasons[0].sessions[0].att.a, false);
  assert.equal(state.seasons[0].sessions[0].att.s, true);
  assert.deepEqual(state.seasons[0].paid.a, ["2026-10-24"]);
});
