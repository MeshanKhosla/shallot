import { Config, Schema } from "effect";

const PositiveInteger = Schema.Int.check(Schema.isGreaterThan(0));
const NonNegativeInteger = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

export function positiveInteger(name: string, fallback: number): Config.Config<number> {
  return Config.schema(PositiveInteger, name).pipe(Config.withDefault(fallback));
}

export function nonNegativeInteger(
  name: string,
  fallback: number,
): Config.Config<number> {
  return Config.schema(NonNegativeInteger, name).pipe(Config.withDefault(fallback));
}

export const debugLoggingEnabled = Config.String("SHALLOT_LOG_LEVEL").pipe(
  Config.withDefault("info"),
  Config.map((level) => level.toLowerCase() === "debug"),
);
