import { Data } from "effect";

export class RelayRouteNotFound extends Data.TaggedError("RelayRouteNotFound") {}

export class RelayAuthenticationError extends Data.TaggedError(
  "RelayAuthenticationError",
) {
  override readonly message = "Tenant authentication failed";
}

export class RelayRequestTooLarge extends Data.TaggedError("RelayRequestTooLarge") {}

export class RelayInvalidRequest extends Data.TaggedError("RelayInvalidRequest") {}

export class RelayReplayDetected extends Data.TaggedError("RelayReplayDetected") {}

export class RelayTrackerCapacityExhausted extends Data.TaggedError(
  "RelayTrackerCapacityExhausted",
) {
  override readonly message = "Relay request tracker is full";
}

export class RelayConcurrencyExhausted extends Data.TaggedError(
  "RelayConcurrencyExhausted",
) {}

export class ExitTimeout extends Data.TaggedError("ExitTimeout") {}

export class ExitTransportFailure extends Data.TaggedError("ExitTransportFailure") {}

export class ExitRejected extends Data.TaggedError("ExitRejected")<{
  readonly status: number;
}> {}

export class ExitEmptyResponse extends Data.TaggedError("ExitEmptyResponse") {}

export type RelayRequestError =
  | RelayRouteNotFound
  | RelayAuthenticationError
  | RelayRequestTooLarge
  | RelayInvalidRequest
  | RelayReplayDetected
  | RelayTrackerCapacityExhausted
  | RelayConcurrencyExhausted
  | ExitTimeout
  | ExitTransportFailure
  | ExitRejected
  | ExitEmptyResponse;

interface PublicError {
  readonly status: number;
  readonly message: string;
  readonly type: string;
}

function publicError(error: RelayRequestError): PublicError {
  switch (error._tag) {
    case "RelayRouteNotFound":
      return {
        status: 404,
        message: "only POST /v1/chat/completions",
        type: "not_found_error",
      };
    case "RelayAuthenticationError":
      return {
        status: 401,
        message: "Tenant authentication failed",
        type: "authentication_error",
      };
    case "RelayRequestTooLarge":
      return {
        status: 413,
        message: "Encrypted request is too large",
        type: "request_too_large",
      };
    case "RelayInvalidRequest":
      return {
        status: 400,
        message: "Invalid encrypted request",
        type: "invalid_request_error",
      };
    case "RelayReplayDetected":
      return {
        status: 409,
        message: "Request ID was replayed",
        type: "replay_error",
      };
    case "RelayTrackerCapacityExhausted":
      return {
        status: 503,
        message: "Relay request tracker is full",
        type: "overloaded_error",
      };
    case "RelayConcurrencyExhausted":
      return {
        status: 429,
        message: "Relay concurrency limit reached",
        type: "rate_limit_error",
      };
    case "ExitTimeout":
    case "ExitTransportFailure":
      return {
        status: 502,
        message: "Exit is unavailable",
        type: "upstream_connection_error",
      };
    case "ExitRejected":
      return {
        status: error.status,
        message: `Exit rejected the request with status ${error.status}`,
        type: "upstream_error",
      };
    case "ExitEmptyResponse":
      return {
        status: 502,
        message: "Exit returned an empty response",
        type: "upstream_error",
      };
  }
}

export function relayErrorResponse(error: RelayRequestError): Response {
  const mapped = publicError(error);
  return Response.json(
    { error: { message: mapped.message, type: mapped.type } },
    { status: mapped.status },
  );
}

export function relayDefectResponse(): Response {
  return Response.json(
    { error: { message: "Relay request failed", type: "internal_error" } },
    { status: 500 },
  );
}
