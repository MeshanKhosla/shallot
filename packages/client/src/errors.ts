export class SidecarHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly type: string,
  ) {
    super(message);
    this.name = "SidecarHttpError";
  }
}

export function errorResponse(status: number, message: string, type: string): Response {
  return Response.json({ error: { message, type } }, { status });
}

export function responseFromError(error: unknown): Response {
  if (error instanceof SidecarHttpError) {
    return errorResponse(error.status, error.message, error.type);
  }
  return errorResponse(500, "Sidecar request failed", "internal_error");
}
