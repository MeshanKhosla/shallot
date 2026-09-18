import { randomUUID } from "node:crypto";
import { Cause, Context, Effect, Layer } from "effect";

export interface DefectDiagnostic {
  readonly component: string;
  readonly event: "request.defect";
  readonly incidentId: string;
}

export class DefectReporter extends Context.Service<
  DefectReporter,
  {
    report(diagnostic: DefectDiagnostic): Effect.Effect<void>;
  }
>()("@shallot/server-runtime/DefectReporter") {}

export const defectReporterLive = Layer.succeed(
  DefectReporter,
  DefectReporter.of({
    report: (diagnostic) =>
      Effect.sync(() => console.error(JSON.stringify(diagnostic))).pipe(
        Effect.ignoreCause,
      ),
  }),
);

export function recoverDefect(
  component: string,
  response: () => Response,
): (cause: Cause.Cause<never>) => Effect.Effect<Response, never, DefectReporter> {
  return (cause) => {
    if (Cause.hasInterruptsOnly(cause)) return Effect.failCause(cause);

    return Effect.gen(function* () {
      const reporter = yield* DefectReporter;
      // The reporter never receives the cause because its message may contain secrets.
      yield* reporter.report({
        component,
        event: "request.defect",
        incidentId: randomUUID(),
      });
      return response();
    });
  };
}
