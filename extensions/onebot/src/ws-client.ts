import WebSocket from "ws";

import type {
  OneBotActionRequest,
  OneBotActionResponse,
  OneBotEventBase,
  OneBotSelf,
} from "./types.js";

export type OneBotClientLogger = {
  debug?: (message: string) => void;
  info?: (message: string) => void;
  warn?: (message: string) => void;
  error?: (message: string) => void;
};

export type OneBotClientOptions = {
  wsUrl: string;
  accessToken?: string;
  logger?: OneBotClientLogger;
  onEvent?: (event: OneBotEventBase) => void;
  onOpen?: () => void;
  onClose?: (code?: number, reason?: string) => void;
  onError?: (err: Error) => void;
  abortSignal?: AbortSignal;
  reconnectDelayMs?: number;
};

type PendingAction = {
  resolve: (value: OneBotActionResponse) => void;
  reject: (err: Error) => void;
  timeout: NodeJS.Timeout;
};

function withAccessToken(url: string, token?: string): string {
  if (!token) return url;
  try {
    const parsed = new URL(url);
    if (!parsed.searchParams.has("access_token")) {
      parsed.searchParams.set("access_token", token);
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

function sanitizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.searchParams.has("access_token")) {
      parsed.searchParams.set("access_token", "***");
    }
    return parsed.toString();
  } catch {
    return url.replace(/access_token=[^&]+/g, "access_token=***");
  }
}

export class OneBotClient {
  private readonly wsUrl: string;
  private readonly accessToken?: string;
  private readonly logger: OneBotClientLogger;
  private readonly onEvent?: (event: OneBotEventBase) => void;
  private readonly onOpen?: () => void;
  private readonly onClose?: (code?: number, reason?: string) => void;
  private readonly onError?: (err: Error) => void;
  private readonly abortSignal?: AbortSignal;
  private readonly reconnectDelayMs: number;
  private ws: WebSocket | null = null;
  private stopped = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private actionCounter = 0;
  private pending = new Map<string, PendingAction>();
  private self: OneBotSelf | null = null;

  constructor(options: OneBotClientOptions) {
    this.wsUrl = options.wsUrl;
    this.accessToken = options.accessToken;
    this.logger = options.logger ?? {};
    this.onEvent = options.onEvent;
    this.onOpen = options.onOpen;
    this.onClose = options.onClose;
    this.onError = options.onError;
    this.abortSignal = options.abortSignal;
    this.reconnectDelayMs = Math.max(1000, options.reconnectDelayMs ?? 2500);
  }

  start(): void {
    if (this.abortSignal?.aborted) {
      this.stopped = true;
      return;
    }
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.clearReconnectTimer();
    this.closeSocket();
    this.rejectAllPending(new Error("OneBot connection stopped"));
  }

  isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  getSelf(): OneBotSelf | null {
    return this.self;
  }

  setSelf(self: OneBotSelf | null): void {
    this.self = self;
  }

  async sendAction(
    action: string,
    params?: Record<string, unknown>,
    options?: { timeoutMs?: number; self?: OneBotSelf | null },
  ): Promise<OneBotActionResponse> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("OneBot is not connected");
    }
    const echo = `onebot:${Date.now()}:${this.actionCounter++}`;
    const request: OneBotActionRequest = {
      action,
      params,
      echo,
      ...(options?.self ?? this.self ? { self: options?.self ?? this.self ?? undefined } : {}),
    };

    const timeoutMs = options?.timeoutMs ?? 10_000;

    return await new Promise<OneBotActionResponse>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(echo);
        reject(new Error(`OneBot action timeout: ${action}`));
      }, timeoutMs);
      this.pending.set(echo, { resolve, reject, timeout });
      try {
        this.ws?.send(JSON.stringify(request));
      } catch (err) {
        clearTimeout(timeout);
        this.pending.delete(echo);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  private connect(): void {
    if (this.stopped) return;

    const url = withAccessToken(this.wsUrl, this.accessToken);
    const headers = this.accessToken ? { Authorization: `Bearer ${this.accessToken}` } : undefined;
    this.logger.info?.(`onebot: connecting to ${sanitizeUrl(url)}`);
    const ws = new WebSocket(url, { headers });
    this.ws = ws;

    ws.on("open", () => {
      this.logger.info?.("onebot: websocket connected");
      this.onOpen?.();
    });

    ws.on("message", (data) => {
      const text = typeof data === "string" ? data : data.toString();
      let payload: unknown;
      try {
        payload = JSON.parse(text);
      } catch (err) {
        this.logger.warn?.(`onebot: failed to parse message: ${String(err)}`);
        return;
      }
      this.handlePayload(payload);
    });

    ws.on("error", (err) => {
      const error = err instanceof Error ? err : new Error(String(err));
      this.logger.error?.(`onebot: websocket error: ${error.message}`);
      this.onError?.(error);
    });

    ws.on("close", (code, reason) => {
      const reasonText = reason?.toString() || "";
      this.logger.warn?.(`onebot: websocket closed (${code}) ${reasonText}`);
      this.onClose?.(code, reasonText);
      this.rejectAllPending(new Error("OneBot connection closed"));
      if (!this.stopped) {
        this.scheduleReconnect();
      }
    });

    this.abortSignal?.addEventListener(
      "abort",
      () => {
        this.stop();
      },
      { once: true },
    );
  }

  private handlePayload(payload: unknown): void {
    if (!payload || typeof payload !== "object") return;
    const asRecord = payload as Record<string, unknown>;
    if (typeof asRecord.status === "string" && typeof asRecord.echo === "string") {
      const entry = this.pending.get(asRecord.echo);
      if (entry) {
        clearTimeout(entry.timeout);
        this.pending.delete(asRecord.echo);
        entry.resolve(asRecord as OneBotActionResponse);
      }
      return;
    }

    if (typeof asRecord.type === "string" && typeof asRecord.detail_type === "string") {
      this.onEvent?.(asRecord as OneBotEventBase);
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.stopped) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.reconnectDelayMs);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private closeSocket(): void {
    if (!this.ws) return;
    const ws = this.ws;
    this.ws = null;
    try {
      ws.close();
    } catch {
      // ignore close errors
    }
  }

  private rejectAllPending(error: Error): void {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timeout);
      entry.reject(error);
    }
    this.pending.clear();
  }
}
