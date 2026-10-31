import { afterEach, describe, expect, it, vi } from "vitest";
import {
  API_REQUEST_ABORTED_ERROR_MESSAGE,
  API_REQUEST_ABORTED_ERROR_NAME,
  API_REQUEST_TIMEOUT_ERROR_MESSAGE,
  API_REQUEST_TIMEOUT_ERROR_NAME,
  ApiRequestAbortedError,
  ApiRequestTimeoutError,
  DEFAULT_API_REQUEST_TIMEOUT_MS,
  UPDATE_USER_SETTINGS_REQUEST_TIMEOUT_MS,
  createApiRequestAbortHandle,
  resolveApiRequestTimeout,
} from "./apiRequestTimeout";

describe("apiRequestTimeout", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses the documented 10s default and a longer settings validation budget", () => {
    expect(DEFAULT_API_REQUEST_TIMEOUT_MS).toBe(10_000);
    expect(UPDATE_USER_SETTINGS_REQUEST_TIMEOUT_MS).toBe(15_000);
    expect(resolveApiRequestTimeout()).toBe(DEFAULT_API_REQUEST_TIMEOUT_MS);
    expect(resolveApiRequestTimeout({})).toBe(DEFAULT_API_REQUEST_TIMEOUT_MS);
  });

  it("accepts an explicit positive finite override", () => {
    const options = Object.freeze({ timeoutMs: 2_750 });

    expect(resolveApiRequestTimeout(options)).toBe(2_750);
    expect(options).toEqual({ timeoutMs: 2_750 });
  });

  it.each([
    0,
    -1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    "1000",
    null,
    {},
    [],
  ])("falls back to the default for invalid override %p", (timeoutMs) => {
    expect(resolveApiRequestTimeout({ timeoutMs })).toBe(DEFAULT_API_REQUEST_TIMEOUT_MS);
  });

  it("detects an already-aborted caller signal before a consumer can fetch", () => {
    vi.useFakeTimers();
    const caller = new AbortController();
    caller.abort();
    const fetchCanary = vi.fn();

    const handle = createApiRequestAbortHandle(caller.signal);
    if (handle.getFailure() === null) {
      fetchCanary();
    }

    expect(fetchCanary).not.toHaveBeenCalled();
    expect(handle.signal.aborted).toBe(true);
    expect(handle.getFailure()).toBeInstanceOf(ApiRequestAbortedError);
    expect(vi.getTimerCount()).toBe(0);
    handle.dispose();
  });

  it("treats a null caller signal the same as an absent one", () => {
    vi.useFakeTimers();
    const handle = createApiRequestAbortHandle(null, { timeoutMs: 100 });

    expect(handle.signal.aborted).toBe(false);
    expect(handle.getFailure()).toBeNull();

    vi.advanceTimersByTime(100);
    expect(handle.getFailure()).toBeInstanceOf(ApiRequestTimeoutError);
    handle.dispose();
  });

  it("produces distinguishable timeout and caller-cancelled failures", () => {
    vi.useFakeTimers();
    const timedHandle = createApiRequestAbortHandle(undefined, { timeoutMs: 100 });
    vi.advanceTimersByTime(100);
    const timeoutFailure = timedHandle.getFailure();

    const caller = new AbortController();
    const cancelledHandle = createApiRequestAbortHandle(caller.signal, { timeoutMs: 100 });
    caller.abort();
    const cancelledFailure = cancelledHandle.getFailure();

    expect(timeoutFailure).toBeInstanceOf(ApiRequestTimeoutError);
    expect(timeoutFailure?.kind).toBe("timeout");
    expect(cancelledFailure).toBeInstanceOf(ApiRequestAbortedError);
    expect(cancelledFailure?.kind).toBe("aborted");
    expect(cancelledFailure).not.toBe(timeoutFailure);

    timedHandle.dispose();
    cancelledHandle.dispose();
  });

  it("clears the internal timeout when the caller cancels first", () => {
    vi.useFakeTimers();
    const caller = new AbortController();
    const handle = createApiRequestAbortHandle(caller.signal, { timeoutMs: 100 });

    vi.advanceTimersByTime(40);
    caller.abort();
    vi.advanceTimersByTime(100);

    expect(handle.getFailure()).toBeInstanceOf(ApiRequestAbortedError);
    expect(vi.getTimerCount()).toBe(0);
    handle.dispose();
  });

  it("keeps caller cancellation ahead of an already-elapsed internal timeout", () => {
    vi.useFakeTimers();
    const caller = new AbortController();
    const handle = createApiRequestAbortHandle(caller.signal, { timeoutMs: 100 });

    vi.advanceTimersByTime(100);
    caller.abort();

    expect(handle.getFailure()).toBeInstanceOf(ApiRequestAbortedError);
    handle.dispose();
  });

  it("keeps error types, names and fixed messages stable without request data", () => {
    const timeoutError = new ApiRequestTimeoutError();
    const abortedError = new ApiRequestAbortedError();

    expect(timeoutError).toMatchObject({
      name: API_REQUEST_TIMEOUT_ERROR_NAME,
      message: API_REQUEST_TIMEOUT_ERROR_MESSAGE,
      kind: "timeout",
    });
    expect(abortedError).toMatchObject({
      name: API_REQUEST_ABORTED_ERROR_NAME,
      message: API_REQUEST_ABORTED_ERROR_MESSAGE,
      kind: "aborted",
    });
    expect(JSON.stringify(timeoutError)).not.toContain("http");
    expect(JSON.stringify(abortedError)).not.toContain("Bearer");
  });

  it("keeps repeated handles independent", () => {
    vi.useFakeTimers();
    const first = createApiRequestAbortHandle(undefined, { timeoutMs: 100 });
    const second = createApiRequestAbortHandle(undefined, { timeoutMs: 200 });

    vi.advanceTimersByTime(100);

    expect(first.getFailure()).toBeInstanceOf(ApiRequestTimeoutError);
    expect(second.getFailure()).toBeNull();
    expect(first.signal).not.toBe(second.signal);
    first.dispose();
    second.dispose();
  });
});
