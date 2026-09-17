import { describe, expect, test } from "bun:test";
import {
  MalformedEncryptedResponse,
  RelayEmptyResponse,
  RelayRejected,
  RelayTimeout,
  RelayTransportFailure,
  SidecarInvalidRequest,
  SidecarRequestTooLarge,
  SidecarRouteNotFound,
  SidecarUnsupportedContentType,
  sidecarDefectResponse,
  sidecarErrorResponse,
} from "./errors.ts";

describe("Sidecar error responses", () => {
  test.each([
    [new SidecarRouteNotFound(), 404, "not_found_error"],
    [new SidecarUnsupportedContentType(), 415, "invalid_request_error"],
    [
      new SidecarInvalidRequest({ message: "request body must be valid JSON" }),
      400,
      "invalid_request_error",
    ],
    [new SidecarRequestTooLarge(), 413, "request_too_large"],
    [new RelayTimeout(), 502, "upstream_connection_error"],
    [new RelayTransportFailure(), 502, "upstream_connection_error"],
    [new RelayRejected({ status: 401 }), 401, "upstream_error"],
    [new RelayEmptyResponse(), 502, "upstream_error"],
    [new MalformedEncryptedResponse(), 502, "upstream_error"],
  ] as const)("maps %s", async (error, status, type) => {
    const response = sidecarErrorResponse(error);

    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ error: { type } });
  });

  test("does not expose defect details", async () => {
    const response = sidecarDefectResponse();
    const body = await response.text();

    expect(response.status).toBe(500);
    expect(body).toContain("Sidecar request failed");
    expect(body).not.toContain("exit-private-key-canary");
  });
});
