export class ExitHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly type: string,
  ) {
    super(message);
    this.name = "ExitHttpError";
  }
}

export function exitErrorResponse(error: unknown): Response {
  const status = error instanceof ExitHttpError ? error.status : 500;
  const type = error instanceof ExitHttpError ? error.type : "internal_error";
  const message = error instanceof ExitHttpError ? error.message : "Exit request failed";
  return Response.json({ error: { message, type } }, { status });
}
