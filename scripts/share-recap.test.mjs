import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appFiles = ["config.js", "rules.js", "data.js", "actions.js", "selectors.js", "component.js"];

function makeContext(overrides = {}) {
  class DCLogic {
    setState(patch) { this.state = { ...this.state, ...patch }; }
  }
  const context = {
    console, Date, Intl, Math, Number, String, Object, Array, Set, JSON,
    setTimeout, clearTimeout, DCLogic,
    navigator: { clipboard: { writeText: async () => {} } },
    document: { querySelector: () => null },
    window: {},
    ...overrides
  };
  const source = appFiles.map((file) => fs.readFileSync(path.join(root, "src", "app", file), "utf8")).join("\n\n");
  vm.createContext(context);
  vm.runInContext(source + "\nthis.ComponentForTest = Component;", context);
  return context;
}

const ids = ["a", "i", "j", "n", "s"];
const names = ["Adam", "Isaiah", "Julian", "Nathan", "Sterling"];

function session(count, date = "2026-10-18", extra = {}) {
  const att = Object.fromEntries(ids.map((id, index) => [id, index < count]));
  return { id: 1, date, activity: "Gaming", game: "WARDOGS", location: "Discord", notes: "", att, attendanceComplete: true, ...extra };
}

function shareFor(context, sessions) {
  return context.buildShareContext({ today: "2026-10-24", share: { status: "idle", text: "", error: "", id: null } }, { sessions });
}

test("the mug has fixed dimensions, alphabetical bottom-up filling, and correct absences at every level", () => {
  const context = makeContext();
  for (let count = 0; count <= 5; count++) {
    const share = shareFor(context, [session(count)]);
    assert.equal(share.complete, true);
    const message = share.message;
    assert.match(message, /^BroTime · Oct 18, 2026\nGaming · WARDOGS · Discord\n\n```/);
    const mug = message.split("```")[1].split("\n").slice(1, -1);
    assert.equal(mug.length, 7);
    assert.equal(mug[0], "╭──────────╮");
    assert.equal(mug[6], `╰──────────╯ ${count}/5`);
    assert.deepEqual(mug.slice(1, 6).map((row) => row.slice(11)), ["├─╮", "│ │", "├─╯", "│", "│"]);
    assert.deepEqual(mug.slice(1, 6).map((row) => row.slice(1, 11).trim()).filter(Boolean), names.slice(0, count));
    assert.doesNotMatch(message, /John/);
    for (const row of mug.slice(1, 6)) assert.equal(row.slice(1, 11).length, 10);
    if (count < 5) assert.match(message, new RegExp(`Out: ${names.slice(count).join(", ")}`));
    else assert.doesNotMatch(message, /\nOut:/);
  }
});

test("the recap uses saved date and metadata, ignores future gatherings, and blocks incomplete attendance", () => {
  const context = makeContext();
  const past = session(5);
  const future = session(0, "2026-10-25", { id: 2, attendanceComplete: false, att: { a: undefined, i: undefined, j: undefined, n: undefined, s: undefined } });
  const latest = shareFor(context, [past, future]);
  assert.equal(latest.id, past.id);
  assert.equal(latest.date, "Oct 18, 2026");

  const futureComplete = session(3, "2026-10-25", { id: 4 });
  assert.equal(shareFor(context, [past, futureComplete]).id, futureComplete.id);

  const incomplete = session(4, "2026-10-20", { id: 3, attendanceComplete: false, att: { a: true, i: true, j: true, n: true, s: undefined } });
  const blocked = shareFor(context, [past, incomplete]);
  assert.equal(blocked.blocked, true);
  assert.equal(blocked.message, "");
  assert.match(blocked.blockedText, /Complete attendance for Oct 20, 2026/);

  const minimal = shareFor(context, [session(2, "2026-10-18", { activity: "Poker", game: "", location: "" })]);
  assert.equal(minimal.message.split("\n")[1], "Poker");
  assert.equal(context.shareDate("2026-10-18"), "Oct 18, 2026");

  const example = session(5, "2026-10-18", { att: { a: true, i: true, j: false, n: true, s: true } });
  assert.equal(shareFor(context, [example]).message, [
    "BroTime · Oct 18, 2026",
    "Gaming · WARDOGS · Discord",
    "",
    "```",
    "╭──────────╮",
    "│          ├─╮",
    "│ Adam     │ │",
    "│ Isaiah   ├─╯",
    "│ Nathan   │",
    "│ Sterling │",
    "╰──────────╯ 4/5",
    "```",
    "",
    "Out: Julian",
    "",
    "https://brotime719.com/"
  ].join("\n"));
});

test("clipboard success changes the button state and failure exposes the exact message", async () => {
  let copied = "";
  const timers = [];
  const context = makeContext({
    navigator: { clipboard: { writeText: async (text) => { copied = text; } } },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeout: () => {}
  });
  const state = {
    ...context.initialState(false),
    today: "2026-10-24",
    seasons: [{ id: 1, name: "2026", closed: false, imported: false, sessions: [session(4)], paid: { s: [], a: [], j: [], n: [], i: [] } }]
  };
  const component = new context.ComponentForTest({});
  component.state = state;
  await component.copyWeeklyRecap();
  assert.equal(component.state.share.status, "copied");
  assert.equal(copied, context.buildContext(state).share.message);
  assert.equal(timers[0].ms, 2000);
  timers[0].fn();
  assert.equal(component.state.share.status, "idle");

  context.navigator.clipboard.writeText = async () => { throw new Error("forced failure"); };
  await component.copyWeeklyRecap();
  assert.equal(component.state.share.status, "fallback");
  assert.equal(component.state.share.text, copied);
  assert.match(component.state.share.error, /Select the message/);

  let focused = false;
  let selected = false;
  context.document.querySelector = () => ({ focus: () => { focused = true; }, select: () => { selected = true; } });
  component.selectShareFallback();
  assert.equal(focused, true);
  assert.equal(selected, true);
});

test("the fallback field is bound as a selectable exact-message value", () => {
  const template = fs.readFileSync(path.join(root, "src", "template.html"), "utf8");
  assert.match(template, /<textarea[^>]+data-share-fallback[^>]+value="\{\{shareFallbackText\}\}"/);
});
