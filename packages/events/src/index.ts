import {
  BrokerEventTypeSchema,
  EventEnvelopeSchema,
  PROTOCOL_VERSION,
  type EventEnvelope
} from "@portus/protocol";

export {
  BrokerEventSchema,
  BrokerEventTypeSchema,
  EventEnvelopeSchema,
  type EventEnvelope
} from "@portus/protocol";

export type BrokerEventSubscriber = (event: EventEnvelope) => void;

export interface BrokerEventBusOptions {
  retentionLimit?: number;
  now?: () => Date;
}

export class BrokerEventBus {
  private readonly subscribers = new Set<BrokerEventSubscriber>();
  private readonly events: EventEnvelope[] = [];
  private readonly retentionLimit: number;
  private readonly now: () => Date;
  private nextEventNumber = 1;

  constructor(options: BrokerEventBusOptions = {}) {
    this.retentionLimit = options.retentionLimit ?? 1000;
    this.now = options.now ?? (() => new Date());
  }

  publish(input: Omit<EventEnvelope, "protocolVersion" | "eventId" | "kind" | "createdAt">): EventEnvelope {
    const event = EventEnvelopeSchema.parse({
      protocolVersion: PROTOCOL_VERSION,
      eventId: this.createEventId(),
      kind: "event",
      createdAt: this.now().toISOString(),
      ...input,
      type: BrokerEventTypeSchema.parse(input.type)
    });

    if (this.retentionLimit > 0) {
      this.events.push(event);
      while (this.events.length > this.retentionLimit) this.events.shift();
    }

    for (const subscriber of this.subscribers) subscriber(event);
    return event;
  }

  subscribe(subscriber: BrokerEventSubscriber): () => void {
    this.subscribers.add(subscriber);
    return () => {
      this.subscribers.delete(subscriber);
    };
  }

  list(): EventEnvelope[] {
    return [...this.events];
  }

  private createEventId(): string {
    return `evt_${String(this.nextEventNumber++).padStart(6, "0")}`;
  }
}
