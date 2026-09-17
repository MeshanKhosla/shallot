import { describe, expect, test } from "bun:test";
import {
  ExitEmptyResponse,
  ExitRejected,
  ExitTimeout,
  ExitTransportFailure,
  RelayAuthenticationError,
  RelayConcurrencyExhausted,
  RelayInvalidRequest,
  RelayReplayDetected,
  RelayRequestTooLarge,
  RelayRouteNotFound,
  RelayTrackerCapacityExhausted,
  relayDefectResponse,
  relayErrorResponse,
} from "./errors.ts";

describe("Relay error responses", () => {
  test.each([
    [new RelayRouteNotFound(), 404, "not_found_error"],
    [new RelayAuthenticationError(), 401, "authentication_error"],
    [new RelayRequestTooLarge(), 413, "request_too_large"],
    [new RelayInvalidRequest(), 400, "invalid_request_error"],
    [new RelayReplayDetected(), 409, "replay_error"],
    [new RelayTrackerCapacityExhausted(), 503, "overloaded_error"],
    [new RelayConcurrencyExhausted(), 429, "rate_limit_error"],
    [new ExitTimeout(), 502, "upstream_connection_error"],
    [new ExitTransportFailure(), 502, "upstream_connection_error"],
    [new ExitRejected({ status: 403 }), 403, "upstream_error"],
    [new ExitEmptyResponse(), 502, "upstream_error"],
  ] as const)("maps %s", async (error, status, type) => {
    const response = relayErrorResponse(error);

    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ error: { type } });
  });

  test("does not expose defect details", async () => {
    const response = relayDefectResponse();
    const body = await response.text();

    expect(response.status).toBe(500);
    expect(body).toContain("Relay request failed");
    expect(body).not.toContain("tenant-token-canary");
  });
});
