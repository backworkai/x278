import type {
  AuthorizationRequest,
  PendedDetermination,
  TerminalDetermination
} from "./domain.js";
import { ProtocolError } from "./domain.js";
import type { X278ClientOptions } from "./sdk.js";

export interface X278SubscriptionEvent {
  readonly eventId: string;
  readonly subscription: string;
  readonly authId: string;
  readonly determination: TerminalDetermination;
  readonly deliveredAt: string;
}

export type X278SubscriptionPublishResult = "accepted" | "duplicate";

export interface X278SubscriptionBroker {
  readonly publish: (
    event: X278SubscriptionEvent
  ) => Promise<X278SubscriptionPublishResult>;
  readonly waitFor: (
    subscription: string,
    options?: { readonly timeoutMs?: number }
  ) => Promise<TerminalDetermination>;
  readonly seenEvents: () => ReadonlyArray<string>;
}

interface Waiter {
  readonly resolve: (value: TerminalDetermination) => void;
  readonly reject: (reason: ProtocolError) => void;
  readonly timeout?: ReturnType<typeof setTimeout>;
}

export const createX278SubscriptionEvent = (
  pended: PendedDetermination,
  determination: TerminalDetermination,
  eventId: string = crypto.randomUUID(),
  deliveredAt: string = new Date().toISOString()
): X278SubscriptionEvent => ({
  eventId,
  subscription: pended.subscription,
  authId: pended.authId,
  determination,
  deliveredAt
});

export const createX278SubscriptionBroker = (): X278SubscriptionBroker => {
  const seen = new Set<string>();
  const delivered = new Map<string, TerminalDetermination>();
  const waiters = new Map<string, Array<Waiter>>();

  const publish = async (
    event: X278SubscriptionEvent
  ): Promise<X278SubscriptionPublishResult> => {
    if (seen.has(event.eventId)) {
      return "duplicate";
    }

    if (event.authId !== event.determination.authId) {
      throw new ProtocolError({
        kind: "validation",
        reason: "invalid-subscription-event",
        detail: event
      });
    }

    seen.add(event.eventId);
    delivered.set(event.subscription, event.determination);

    const pending = waiters.get(event.subscription) ?? [];
    waiters.delete(event.subscription);
    for (const waiter of pending) {
      if (waiter.timeout) {
        clearTimeout(waiter.timeout);
      }
      waiter.resolve(event.determination);
    }

    return "accepted";
  };

  const waitFor = (
    subscription: string,
    options: { readonly timeoutMs?: number } = {}
  ): Promise<TerminalDetermination> => {
    const existing = delivered.get(subscription);
    if (existing) {
      return Promise.resolve(existing);
    }

    return new Promise((resolve, reject) => {
      const waiter: Waiter = {
        resolve,
        reject,
        ...(options.timeoutMs
          ? {
              timeout: setTimeout(() => {
                const pending = waiters.get(subscription) ?? [];
                waiters.set(
                  subscription,
                  pending.filter((item) => item !== waiter)
                );
                reject(
                  new ProtocolError({
                    kind: "workflow",
                    reason: "subscription-timeout",
                    detail: { subscription, timeoutMs: options.timeoutMs }
                  })
                );
              }, options.timeoutMs)
            }
          : {})
      };

      waiters.set(subscription, [...(waiters.get(subscription) ?? []), waiter]);
    });
  };

  return {
    publish,
    waitFor,
    seenEvents: () => [...seen]
  };
};

export const awaitPendedWithSubscriptionBroker = (
  broker: X278SubscriptionBroker,
  options: { readonly timeoutMs?: number } = {}
): NonNullable<X278ClientOptions["awaitPended"]> =>
  (_request: AuthorizationRequest, pended: PendedDetermination) =>
    broker.waitFor(pended.subscription, options);
