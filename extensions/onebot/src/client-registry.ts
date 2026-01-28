import type { OneBotClient } from "./ws-client.js";

const clients = new Map<string, OneBotClient>();

export function setOneBotClient(accountId: string, client: OneBotClient): void {
  clients.set(accountId, client);
}

export function getOneBotClient(accountId: string): OneBotClient | undefined {
  return clients.get(accountId);
}

export function deleteOneBotClient(accountId: string): void {
  clients.delete(accountId);
}

export function clearOneBotClients(): void {
  clients.clear();
}
