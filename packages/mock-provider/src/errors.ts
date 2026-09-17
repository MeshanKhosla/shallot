import { Data } from "effect";

export class ProviderRouteNotFound extends Data.TaggedError("ProviderRouteNotFound") {}

export class ProviderAuthenticationError extends Data.TaggedError(
  "ProviderAuthenticationError",
) {}

export class ProviderInvalidRequest extends Data.TaggedError("ProviderInvalidRequest") {}

export type MockProviderRequestError =
  | ProviderRouteNotFound
  | ProviderAuthenticationError
  | ProviderInvalidRequest;

export function providerErrorResponse(error: MockProviderRequestError): Response {
  switch (error._tag) {
    case "ProviderRouteNotFound":
      return Response.json(
        {
          error: {
            message: "only POST /v1/chat/completions",
            type: "not_found_error",
          },
        },
        { status: 404 },
      );
    case "ProviderAuthenticationError":
      return Response.json(
        {
          error: {
            message: "provider authentication failed",
            type: "authentication_error",
          },
        },
        { status: 401 },
      );
    case "ProviderInvalidRequest":
      return Response.json(
        {
          error: {
            message: "invalid chat request",
            type: "invalid_request_error",
          },
        },
        { status: 400 },
      );
  }
}

export function providerDefectResponse(): Response {
  return Response.json(
    { error: { message: "Provider request failed", type: "internal_error" } },
    { status: 500 },
  );
}
