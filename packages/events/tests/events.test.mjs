import assert from "node:assert/strict";
import test from "node:test";
import { BrokerEventBus } from "../dist/index.js";

test("publishes validated broker events and retains recent events", () => {
  const events = [];
  const bus = new BrokerEventBus({
    retentionLimit: 1,
    now: () => new Date("2026-04-28T00:00:00.000Z")
  });
  bus.subscribe((event) => events.push(event));

  const first = bus.publish({
    type: "bridge.connected",
    browserId: "br_001",
    payload: {
      browserId: "br_001",
      browserName: "Chrome"
    }
  });
  const second = bus.publish({
    type: "session.registered",
    browserId: "br_001",
    payload: {
      session: {
        browserId: "br_001"
      }
    }
  });

  assert.equal(first.eventId, "evt_000001");
  assert.equal(second.eventId, "evt_000002");
  assert.equal(events.length, 2);
  assert.deepEqual(bus.list().map((event) => event.eventId), ["evt_000002"]);
});
