import { describe, expect, test } from "bun:test";
import {
  ExitAuthenticationError,
  ExitInvalidRequest,
  ExitReplayCapacityExhausted,
  ExitReplayDetected,
  ExitRequestTooLarge,
  ExitRouteNotFound,
  encryptedProviderFailure,
  exitDefectResponse,
  exitErrorResponse,
  ProviderTimeout,
  ProviderTransportFailure,
} from "../src/errors.ts";

describe("Exit error responses", () => {
  test.each([
    [new ExitRouteNotFound(), 404, "not_found_error"],
    [new ExitAuthenticationError(), 401, "authentication_error"],
    [new ExitRequestTooLarge(), 413, "request_too_large"],
    [
      new ExitInvalidRequest({ message: "Invalid encrypted request" }),
      400,
      "invalid_request_error",
    ],
    [new ExitReplayDetected(), 409, "replay_error"],
    [new ExitReplayCapacityExhausted(), 503, "overloaded_error"],
  ] as const)("maps %s", async (error, status, type) => {
    const response = exitErrorResponse(error);

    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ error: { type } });
  });

  test.each([
    [new ProviderTimeout(), 504, "AI provider timed out"],
    [new ProviderTransportFailure(), 502, "AI provider is unavailable"],
  ] as const)("maps encrypted %s", async (error, status, message) => {
    const response = encryptedProviderFailure(error);

    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({
      error: { message, type: "provider_error" },
    });
  });

  test("does not expose defect details", async () => {
    const response = exitDefectResponse();
    const body = await response.text();

    expect(response.status).toBe(500);
    expect(body).toContain("Exit request failed");
    expect(body).not.toContain("private-key-canary");
  });
});
