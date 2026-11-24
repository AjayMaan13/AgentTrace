"use client";

import { useAuth } from "@clerk/nextjs";
import { useCallback } from "react";
import { parseSse, type SseEvent } from "./sse";

const API_URL = process.env.NEXT_PUBLIC_API_URL;

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** fetch against the AgentTrace API with the signed-in user's Clerk session token as a Bearer
 * token. The API takes the workspace from the token's active organization, never from us. */
export function useApi() {
  const { getToken } = useAuth();
  return useCallback(
    async <T,>(path: string, init: RequestInit = {}): Promise<T> => {
      const token = await getToken();
      const res = await fetch(`${API_URL}${path}`, {
        ...init,
        headers: {
          ...(init.body ? { "Content-Type": "application/json" } : {}),
          ...init.headers,
          Authorization: `Bearer ${token}`,
        },
      });
      if (!res.ok) {
        const detail = (await res.json().catch(() => null))?.detail;
        throw new ApiError(res.status, typeof detail === "string" ? detail : res.statusText);
      }
      return res.json() as Promise<T>;
    },
    [getToken],
  );
}

/** POST to a server-sent-events route with the signed-in user's token and call `onEvent` for each event as it arrives. A refusal before
 * the stream starts (a limit, a bad request) throws an ApiError like `useApi` does; `signal` cancels the stream. */
export function useApiStream() {
  const { getToken } = useAuth();
  return useCallback(
    async (path: string, body: unknown, onEvent: (event: SseEvent) => void, signal?: AbortSignal): Promise<void> => {
      const token = await getToken();
      const res = await fetch(`${API_URL}${path}`, {
        method: "POST",
        signal,
        headers: { "Content-Type": "application/json", Accept: "text/event-stream", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const detail = (await res.json().catch(() => null))?.detail;
        throw new ApiError(res.status, typeof detail === "string" ? detail : res.statusText);
      }
      if (!res.body) throw new ApiError(res.status, "The response had no body");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let rest = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const parsed = parseSse(rest + decoder.decode(value, { stream: true }));
        rest = parsed.rest;
        parsed.events.forEach(onEvent);
      }
    },
    [getToken],
  );
}
