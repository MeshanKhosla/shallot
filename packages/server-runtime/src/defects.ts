import { randomUUID } from "node:crypto";
import { Cause, Effect } from "effect";

export interface DefectDiagnostic {
  readonly component: string;
  readonly event: "request.defect";
  readonly incidentId: string;
}

export type DefectReporter = (diagnostic: DefectDiagnostic) => void;

const reportToConsole: DefectReporter = (diagnostic) => {
  console.error(JSON.stringify(diagnostic));
};

export function recoverDefect(
  component: string,
  response: () => Response,
  report: DefectReporter = reportToConsole,
): (cause: Cause.Cause<never>) => Effect.Effect<Response> {
  return (cause) => {
    if (Cause.hasInterruptsOnly(cause)) return Effect.failCause(cause);

    return Effect.sync(() => {
      report({
        component,
        event: "request.defect",
        incidentId: randomUUID(),
      });
      return response();
    });
  };
}
