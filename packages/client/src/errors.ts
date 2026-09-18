import { Data } from "effect";

export class SidecarRouteNotFound extends Data.TaggedError("SidecarRouteNotFound") {}

export class SidecarUnsupportedContentType extends Data.TaggedError(
  "SidecarUnsupportedContentType",
) {}

export class SidecarInvalidRequest extends Data.TaggedError("SidecarInvalidRequest")<{
  readonly message: string;
}> {}

export class SidecarRequestTooLarge extends Data.TaggedError("SidecarRequestTooLarge") {}

export class RelayTimeout extends Data.TaggedError("RelayTimeout") {}

export class RelayTransportFailure extends Data.TaggedError("RelayTransportFailure") {}

export class RelayRejected extends Data.TaggedError("RelayRejected")<{
  readonly status: number;
}> {}

export class RelayEmptyResponse extends Data.TaggedError("RelayEmptyResponse") {}

export class MalformedEncryptedResponse extends Data.TaggedError(
  "MalformedEncryptedResponse",
) {
  override readonly message = "Relay returned an invalid encrypted response";
}

export type SidecarRequestError =
  | SidecarRouteNotFound
  | SidecarUnsupportedContentType
  | SidecarInvalidRequest
  | SidecarRequestTooLarge
  | RelayTimeout
  | RelayTransportFailure
  | RelayRejected
  | RelayEmptyResponse
  | MalformedEncryptedResponse;

interface PublicError {
  readonly status: number;
  readonly message: string;
  readonly type: string;
}

function publicError(error: SidecarRequestError): PublicError {
  switch (error._tag) {
    case "SidecarRouteNotFound":
      return {
        status: 404,
        message: "only POST /v1/chat/completions",
        type: "not_found_error",
      };
    case "SidecarUnsupportedContentType":
      return {
        status: 415,
        message: "content-type must be application/json",
        type: "invalid_request_error",
      };
    case "SidecarInvalidRequest":
      return {
        status: 400,
        message: error.message,
        type: "invalid_request_error",
      };
    case "SidecarRequestTooLarge":
      return {
        status: 413,
        message: "request body is too large",
        type: "request_too_large",
      };
    case "RelayTimeout":
    case "RelayTransportFailure":
      return {
        status: 502,
        message: "Relay is unavailable",
        type: "upstream_connection_error",
      };
    case "RelayRejected":
      return {
        status: error.status,
        message: `Relay rejected the request with status ${error.status}`,
        type: "upstream_error",
      };
    case "RelayEmptyResponse":
      return {
        status: 502,
        message: "Relay returned an empty response",
        type: "upstream_error",
      };
    case "MalformedEncryptedResponse":
      return {
        status: 502,
        message: "Relay returned an invalid encrypted response",
        type: "upstream_error",
      };
  }
}

export function sidecarErrorResponse(error: SidecarRequestError): Response {
  const mapped = publicError(error);
  return Response.json(
    { error: { message: mapped.message, type: mapped.type } },
    { status: mapped.status },
  );
}

export function sidecarDefectResponse(): Response {
  return Response.json(
    { error: { message: "Sidecar request failed", type: "internal_error" } },
    { status: 500 },
  );
}
