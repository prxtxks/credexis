/**
 * Sentry PII scrub (M10.2/M10.3): tax documents carry SSNs/EINs, so no
 * request payload, cookie, or header may reach the error tracker. Kept as
 * a pure helper so the log-PII-scrub verification is a unit test, not a
 * hope.
 */

export interface ScrubbableEvent {
  request?: {
    data?: unknown;
    cookies?: unknown;
    headers?: unknown;
    url?: string;
  };
  user?: unknown;
}

export function scrubEvent<E extends ScrubbableEvent>(event: E): E {
  if (event.request) {
    delete event.request.data;
    delete event.request.cookies;
    delete event.request.headers;
  }
  // Identity stays out of the tracker entirely; run ids are the join key.
  delete event.user;
  return event;
}
