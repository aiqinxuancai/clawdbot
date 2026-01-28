import type { ClawdbotConfig } from "clawdbot/plugin-sdk";
import { DEFAULT_ACCOUNT_ID, normalizeAccountId } from "clawdbot/plugin-sdk";

import type { OneBotAccountConfig, OneBotConfig, ResolvedOneBotAccount } from "./types.js";

function listConfiguredAccountIds(cfg: ClawdbotConfig): string[] {
  const accounts = (cfg.channels?.onebot as OneBotConfig | undefined)?.accounts;
  if (!accounts || typeof accounts !== "object") return [];
  return Object.keys(accounts).filter(Boolean);
}

export function listOneBotAccountIds(cfg: ClawdbotConfig): string[] {
  const ids = listConfiguredAccountIds(cfg);
  if (ids.length === 0) return [DEFAULT_ACCOUNT_ID];
  return ids.sort((a, b) => a.localeCompare(b));
}

export function resolveDefaultOneBotAccountId(cfg: ClawdbotConfig): string {
  const onebotConfig = cfg.channels?.onebot as OneBotConfig | undefined;
  if (onebotConfig?.defaultAccount?.trim()) return onebotConfig.defaultAccount.trim();
  const ids = listOneBotAccountIds(cfg);
  if (ids.includes(DEFAULT_ACCOUNT_ID)) return DEFAULT_ACCOUNT_ID;
  return ids[0] ?? DEFAULT_ACCOUNT_ID;
}

function resolveAccountConfig(
  cfg: ClawdbotConfig,
  accountId: string,
): OneBotAccountConfig | undefined {
  const accounts = (cfg.channels?.onebot as OneBotConfig | undefined)?.accounts;
  if (!accounts || typeof accounts !== "object") return undefined;
  return accounts[accountId] as OneBotAccountConfig | undefined;
}

function mergeOneBotAccountConfig(cfg: ClawdbotConfig, accountId: string): OneBotAccountConfig {
  const raw = (cfg.channels?.onebot ?? {}) as OneBotConfig;
  const { accounts: _ignored, defaultAccount: _ignored2, ...base } = raw;
  const account = resolveAccountConfig(cfg, accountId) ?? {};
  return { ...base, ...account } as OneBotAccountConfig;
}

export function resolveOneBotAccount(params: {
  cfg: ClawdbotConfig;
  accountId?: string | null;
}): ResolvedOneBotAccount {
  const accountId = normalizeAccountId(params.accountId);
  const baseEnabled = (params.cfg.channels?.onebot as OneBotConfig | undefined)?.enabled !== false;
  const merged = mergeOneBotAccountConfig(params.cfg, accountId);
  const accountEnabled = merged.enabled !== false;
  const enabled = baseEnabled && accountEnabled;
  const wsUrl = merged.wsUrl?.trim();

  return {
    accountId,
    name: merged.name?.trim() || undefined,
    enabled,
    wsUrl,
    accessToken: merged.accessToken?.trim() || undefined,
    platform: merged.platform?.trim() || undefined,
    selfId: merged.selfId?.trim() || undefined,
    requireMention: merged.requireMention,
    configured: Boolean(wsUrl),
    config: merged,
  } satisfies ResolvedOneBotAccount;
}
