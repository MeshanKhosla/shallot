import { describe, expect, test } from "bun:test";
import { Cause, Effect } from "effect";
import { type DefectDiagnostic, recoverDefect } from "../src/defects.ts";

describe("defect diagnostics", () => {
  test("records an incident without passing defect content to the reporter", async () => {
    const diagnostics: DefectDiagnostic[] = [];
    const response = await Effect.runPromise(
      recoverDefect(
        "relay",
        () => new Response("generic", { status: 500 }),
        (diagnostic) => diagnostics.push(diagnostic),
      )(Cause.die(new Error("credential-canary"))),
    );

    expect(response.status).toBe(500);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.component).toBe("relay");
    expect(diagnostics[0]?.event).toBe("request.defect");
    expect(diagnostics[0]?.incidentId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(JSON.stringify(diagnostics)).not.toContain("credential-canary");
  });

  test("does not report request interruption as a defect", async () => {
    const diagnostics: DefectDiagnostic[] = [];
    const exit = await Effect.runPromiseExit(
      recoverDefect(
        "relay",
        () => new Response(null, { status: 500 }),
        (diagnostic) => diagnostics.push(diagnostic),
      )(Cause.interrupt()),
    );

    expect(exit._tag).toBe("Failure");
    expect(diagnostics).toHaveLength(0);
  });
});
