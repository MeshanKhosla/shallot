import { Data } from "effect";

export class ExitRouteNotFound extends Data.TaggedError("ExitRouteNotFound") {}

export class ExitAuthenticationError extends Data.TaggedError("ExitAuthenticationError") {
  override readonly message = "Relay authentication failed";
}

export class ExitRequestTooLarge extends Data.TaggedError("ExitRequestTooLarge") {}

export class ExitInvalidRequest extends Data.TaggedError("ExitInvalidRequest")<{
  readonly message: string;
}> {}

export class ExitReplayDetected extends Data.TaggedError("ExitReplayDetected") {}

export class ExitReplayCapacityExhausted extends Data.TaggedError(
  "ExitReplayCapacityExhausted",
) {}

export class ProviderTimeout extends Data.TaggedError("ProviderTimeout") {}

export class ProviderTransportFailure extends Data.TaggedError(
  "ProviderTransportFailure",
) {}

export type ExitRequestError =
  | ExitRouteNotFound
  | ExitAuthenticationError
  | ExitRequestTooLarge
  | ExitInvalidRequest
  | ExitReplayDetected
  | ExitReplayCapacityExhausted;

export type ProviderFailure = ProviderTimeout | ProviderTransportFailure;

interface PublicError {
  readonly status: number;
  readonly message: string;
  readonly type: string;
}

function publicError(error: ExitRequestError): PublicError {
  switch (error._tag) {
    case "ExitRouteNotFound":
      return {
        status: 404,
        message: "only POST /v1/chat/completions",
        type: "not_found_error",
      };
    case "ExitAuthenticationError":
      return {
        status: 401,
        message: "Relay authentication failed",
        type: "authentication_error",
      };
    case "ExitRequestTooLarge":
      return {
        status: 413,
        message: "Encrypted request is too large",
        type: "request_too_large",
      };
    case "ExitInvalidRequest":
      return {
        status: 400,
        message: error.message,
        type: "invalid_request_error",
      };
    case "ExitReplayDetected":
      return {
        status: 409,
        message: "Encrypted request was replayed",
        type: "replay_error",
      };
    case "ExitReplayCapacityExhausted":
      return {
        status: 503,
        message: "Exit replay cache is full",
        type: "overloaded_error",
      };
  }
}

export function exitErrorResponse(error: ExitRequestError): Response {
  const mapped = publicError(error);
  return Response.json(
    { error: { message: mapped.message, type: mapped.type } },
    { status: mapped.status },
  );
}

export function exitDefectResponse(): Response {
  return Response.json(
    { error: { message: "Exit request failed", type: "internal_error" } },
    { status: 500 },
  );
}

export function encryptedProviderFailure(error: ProviderFailure): Response {
  const timedOut = error._tag === "ProviderTimeout";
  return Response.json(
    {
      error: {
        message: timedOut ? "AI provider timed out" : "AI provider is unavailable",
        type: "provider_error",
      },
    },
    { status: timedOut ? 504 : 502 },
  );
}
