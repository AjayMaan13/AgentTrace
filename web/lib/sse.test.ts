import assert from "node:assert/strict";
import { test } from "node:test";
import { parseSse } from "./sse.ts";

test("complete events come out parsed, and nothing is left over", () => {
  const { events, rest } = parseSse('event: status\ndata: {"message":"Searching the docs"}\n\nevent: text\ndata: {"delta":"Add "}\n\n');
  assert.deepEqual(events, [
    { event: "status", data: { message: "Searching the docs" } },
    { event: "text", data: { delta: "Add " } },
  ]);
  assert.equal(rest, "");
});

test("an event cut in two by the network is finished when the rest arrives", () => {
  const first = parseSse('event: text\ndata: {"delta":"He');
  assert.deepEqual(first.events, []);
  const second = parseSse(first.rest + 'llo"}\n\nevent: result\ndata: {"answer":"Hello"}\n\n');
  assert.deepEqual(second.events.map((e) => e.event), ["text", "result"]);
  assert.deepEqual(second.events[0].data, { delta: "Hello" });
});

test("a blank-line split across two chunks does not lose the event", () => {
  const first = parseSse('event: text\ndata: {"delta":"a"}\n');
  assert.deepEqual(first.events, []);
  assert.equal(parseSse(first.rest + "\n").events.length, 1);
});

test("keep-alive comments, events with no data and events that are not JSON are skipped", () => {
  const { events } = parseSse(': keep-alive\n\nevent: empty\n\nevent: odd\ndata: not json\n\nevent: ok\ndata: {"a":1}\n\n');
  assert.deepEqual(events, [{ event: "ok", data: { a: 1 } }]);
});

test("Windows line endings and a data field spread over lines both work", () => {
  const { events } = parseSse('event: result\r\ndata: {"a":\r\ndata: 1}\r\n\r\n');
  assert.deepEqual(events, [{ event: "result", data: { a: 1 } }]);
});

test("an event with no name is a message", () => {
  assert.deepEqual(parseSse('data: {"x":true}\n\n').events, [{ event: "message", data: { x: true } }]);
});
