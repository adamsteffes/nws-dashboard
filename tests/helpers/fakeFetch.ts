import { readFileSync } from "node:fs";
import { join } from "node:path";

const FIXTURE_DIR = join(import.meta.dirname, "..", "fixtures", "nws");

export type Step =
  /** A fixture name, or "timeout" for a thrown TimeoutError. */
  | string
  /** A bare HTTP status with a problem+json body. */
  | number
  | { fixture: string }
  /** Never answers; rejects with the signal's reason once it aborts. */
  | { hang: true }
  /** Headers arrive, then the body stream fails mid-read. */
  | { bodyError: Error }
  | { status: number; headers?: Record<string, string>; body?: unknown }
  | Error
  | (() => Promise<Response>);

export type Routes = Record<string, Step | Step[]>;

export type RecordedCall = { url: string; init: RequestInit | undefined };

export type FakeFetch = typeof fetch & { calls: RecordedCall[] };

const readJson = (file: string): unknown =>
  JSON.parse(readFileSync(join(FIXTURE_DIR, file), "utf-8"));

function fixtureResponse(name: string): Response {
  const body = readJson(`${name}.json`) as { status?: unknown };
  let status = typeof body.status === "number" ? body.status : 200;
  let headers: Record<string, string> = {};
  try {
    const sidecar = readJson(`${name}.headers.json`) as {
      status: number;
      headers: Record<string, string>;
    };
    status = sidecar.status;
    headers = sidecar.headers;
  } catch {
    // Hand-written fixtures (problem_500, points_404) have no sidecar.
    if (status >= 400) headers = { "content-type": "application/problem+json" };
  }
  return new Response(JSON.stringify(body), { status, headers });
}

function respond(step: Step, init?: RequestInit): Response | Promise<Response> {
  if (typeof step === "function") return step();
  if (step instanceof Error) throw step;
  if (step === "timeout") {
    throw new DOMException("The operation timed out.", "TimeoutError");
  }
  if (typeof step === "string") return fixtureResponse(step);
  if (typeof step === "number") {
    const body = { ...(readJson("problem_500.json") as object), status: step };
    return new Response(JSON.stringify(body), {
      status: step,
      headers: { "content-type": "application/problem+json" },
    });
  }
  if ("hang" in step) {
    return new Promise<Response>((_, reject) => {
      const signal = init?.signal;
      if (!signal) return;
      const fail = () => reject(signal.reason);
      if (signal.aborted) fail();
      else signal.addEventListener("abort", fail, { once: true });
    });
  }
  if ("bodyError" in step) {
    const { bodyError } = step;
    const body = new ReadableStream({
      pull(controller) {
        controller.error(bodyError);
      },
    });
    return new Response(body, { status: 200 });
  }
  if ("fixture" in step) return fixtureResponse(step.fixture);
  const body =
    typeof step.body === "string" ? step.body : JSON.stringify(step.body ?? {});
  return new Response(body, { status: step.status, headers: step.headers });
}

/**
 * Builds a fetch from a route table. A single step answers every call to its
 * URL; an array is consumed in order and errors once exhausted, so tests
 * notice unexpected extra requests.
 */
export function createFakeFetch(routes: Routes): FakeFetch {
  const positions = new Map<string, number>();
  const calls: RecordedCall[] = [];

  const fake = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = input instanceof Request ? input.url : String(input);
    calls.push({ url, init });
    const route = routes[url];
    if (route === undefined) {
      throw new Error(`fakeFetch: no route for ${url}`);
    }
    if (!Array.isArray(route)) return respond(route, init);
    const i = positions.get(url) ?? 0;
    const step = route[i];
    if (step === undefined) {
      throw new Error(`fakeFetch: route for ${url} exhausted after ${i} calls`);
    }
    positions.set(url, i + 1);
    return respond(step, init);
  };
  return Object.assign(fake, { calls }) as FakeFetch;
}
