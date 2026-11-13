export type ProblemDetails = {
  title?: string;
  detail?: string;
  correlationId?: string;
};

export type NwsErrorInit = ProblemDetails & { cause?: unknown };

export class NwsError extends Error {
  override name = "NwsError";
  status: number;
  url: string;
  title?: string;
  detail?: string;
  correlationId?: string;

  constructor(
    message: string,
    status: number,
    url: string,
    init: NwsErrorInit = {},
  ) {
    super(
      message,
      init.cause === undefined ? undefined : { cause: init.cause },
    );
    this.status = status;
    this.url = url;
    this.title = init.title;
    this.detail = init.detail;
    this.correlationId = init.correlationId;
  }
}

/** The NWS has no data for this resource; callers use it to re-resolve a location. */
export class NwsNotFound extends NwsError {
  constructor(url: string, init: NwsErrorInit = {}) {
    super(init.title ?? "Not found", 404, url, init);
    this.name = "NwsNotFound";
  }
}

/** The device is offline and nothing is cached for the URL. */
export class NwsOfflineError extends NwsError {
  constructor(url: string) {
    super("Offline and nothing cached", 0, url, { title: "Offline" });
    this.name = "NwsOfflineError";
  }
}

const str = (v: unknown): string | undefined =>
  typeof v === "string" && v !== "" ? v : undefined;

/** Extracts the fields we surface from an application/problem+json body. */
export function parseProblem(body: unknown): ProblemDetails {
  if (typeof body !== "object" || body === null) return {};
  const record = body as Record<string, unknown>;
  return {
    title: str(record.title),
    detail: str(record.detail),
    correlationId: str(record.correlationId),
  };
}
