export class RelayHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly type: string,
  ) {
    super(message);
    this.name = "RelayHttpError";
  }
}

export function relayErrorResponse(error: unknown): Response {
  const status = error instanceof RelayHttpError ? error.status : 500;
  const type = error instanceof RelayHttpError ? error.type : "internal_error";
  const message =
    error instanceof RelayHttpError ? error.message : "Relay request failed";
  return Response.json({ error: { message, type } }, { status });
}
