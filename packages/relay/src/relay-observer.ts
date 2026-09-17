import { Context, Layer } from "effect";

export interface RelayObservation {
  tenantId: string;
  requestId: string;
  body: string;
  forwardedHeaders: Headers;
}

export class RelayObserver extends Context.Service<
  RelayObserver,
  {
    readonly observeRequest: (observation: RelayObservation) => void;
    readonly observeResponseChunk: (chunk: Uint8Array) => void;
  }
>()("@shallot/relay/RelayObserver") {}

export const relayObserverNoop = Layer.succeed(RelayObserver, {
  observeRequest() {},
  observeResponseChunk() {},
});

export function relayObserverLayer(
  observer: Partial<RelayObserver["Service"]>,
): Layer.Layer<RelayObserver> {
  return Layer.succeed(RelayObserver, {
    observeRequest: observer.observeRequest ?? (() => undefined),
    observeResponseChunk: observer.observeResponseChunk ?? (() => undefined),
  });
}
