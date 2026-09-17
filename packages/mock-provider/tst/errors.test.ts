import { describe, expect, test } from "bun:test";
import {
  ProviderAuthenticationError,
  ProviderInvalidRequest,
  ProviderRouteNotFound,
  providerDefectResponse,
  providerErrorResponse,
} from "../src/errors.ts";

describe("Mock provider error responses", () => {
  test.each([
    [new ProviderRouteNotFound(), 404, "not_found_error"],
    [new ProviderAuthenticationError(), 401, "authentication_error"],
    [new ProviderInvalidRequest(), 400, "invalid_request_error"],
  ] as const)("maps %s", async (error, status, type) => {
    const response = providerErrorResponse(error);

    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ error: { type } });
  });

  test("does not expose defect details", async () => {
    const response = providerDefectResponse();
    const body = await response.text();

    expect(response.status).toBe(500);
    expect(body).toContain("Provider request failed");
    expect(body).not.toContain("provider-key-canary");
  });
});
