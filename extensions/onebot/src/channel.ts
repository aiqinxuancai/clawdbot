import type { ChannelAccountSnapshot, ChannelPlugin, ClawdbotConfig } from "clawdbot/plugin-sdk";
import {
  applyAccountNameToChannelSection,
  buildChannelConfigSchema,
  DEFAULT_ACCOUNT_ID,
  deleteAccountFromConfigSection,
  formatPairingApproveHint,
  normalizeAccountId,
  PAIRING_APPROVED_MESSAGE,
  setAccountEnabledInConfigSection,
} from "clawdbot/plugin-sdk";

import {
  listOneBotAccountIds,
  resolveDefaultOneBotAccountId,
  resolveOneBotAccount,
} from "./accounts.js";
import { OneBotConfigSchema } from "./config-schema.js";
import type { ResolvedOneBotAccount } from "./types.js";
import { normalizeOneBotUserId } from "./normalize.js";
import { looksLikeOneBotTargetId, formatOneBotTargetHint, normalizeOneBotMessagingTarget } from "./targets.js";
import { onebotOutbound, sendOneBotMessage } from "./outbound.js";
import { monitorOneBotProvider } from "./monitor.js";

const CHANNEL_ID = "onebot" as const;

const meta = {
  id: CHANNEL_ID,
  label: "QQ (OneBot 12)",
  selectionLabel: "QQ (OneBot 12)",
  detailLabel: "QQ Bot",
  docsPath: "/channels/onebot",
  docsLabel: "onebot",
  blurb: "OneBot 12 protocol for QQ bots over WebSocket.",
  aliases: ["qq", "onebot12", "onebot-12"],
  order: 85,
  quickstartAllowFrom: true,
  systemImage: "message",
};

export const onebotPlugin: ChannelPlugin<ResolvedOneBotAccount> = {
  id: CHANNEL_ID,
  meta,
  capabilities: {
    chatTypes: ["direct", "group", "channel"],
    media: false,
  },
  reload: { configPrefixes: ["channels.onebot"] },
  configSchema: buildChannelConfigSchema(OneBotConfigSchema),
  config: {
    listAccountIds: (cfg) => listOneBotAccountIds(cfg),
    resolveAccount: (cfg, accountId) => resolveOneBotAccount({ cfg, accountId }),
    defaultAccountId: (cfg) => resolveDefaultOneBotAccountId(cfg),
    setAccountEnabled: ({ cfg, accountId, enabled }) =>
      setAccountEnabledInConfigSection({
        cfg,
        sectionKey: CHANNEL_ID,
        accountId,
        enabled,
        allowTopLevel: true,
      }),
    deleteAccount: ({ cfg, accountId }) =>
      deleteAccountFromConfigSection({
        cfg,
        sectionKey: CHANNEL_ID,
        accountId,
        clearBaseFields: ["wsUrl", "accessToken", "platform", "selfId", "name"],
      }),
    isConfigured: (account) => account.configured,
    describeAccount: (account): ChannelAccountSnapshot => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: account.configured,
      wsUrl: account.wsUrl,
      platform: account.platform,
      selfId: account.selfId,
    }),
    resolveAllowFrom: ({ cfg, accountId }) =>
      (resolveOneBotAccount({ cfg, accountId }).config.allowFrom ?? []).map((entry) =>
        String(entry),
      ),
    formatAllowFrom: ({ allowFrom }) =>
      allowFrom
        .map((entry) => String(entry).trim())
        .filter(Boolean)
        .map((entry) => normalizeOneBotUserId(entry)),
  },
  pairing: {
    idLabel: "qqUserId",
    normalizeAllowEntry: (entry) => normalizeOneBotUserId(entry),
    notifyApproval: async ({ cfg, id }) => {
      const account = resolveOneBotAccount({ cfg, accountId: DEFAULT_ACCOUNT_ID });
      if (!account.configured) {
        throw new Error("OneBot wsUrl not configured");
      }
      await sendOneBotMessage({
        account,
        target: `user:${id}`,
        text: PAIRING_APPROVED_MESSAGE,
      });
    },
  },
  security: {
    resolveDmPolicy: ({ cfg, accountId, account }) => {
      const resolvedAccountId = accountId ?? account.accountId ?? DEFAULT_ACCOUNT_ID;
      const useAccountPath = Boolean((cfg as ClawdbotConfig).channels?.onebot?.accounts?.[resolvedAccountId]);
      const basePath = useAccountPath
        ? `channels.onebot.accounts.${resolvedAccountId}.`
        : "channels.onebot.";
      return {
        policy: account.config.dmPolicy ?? "pairing",
        allowFrom: account.config.allowFrom ?? [],
        policyPath: `${basePath}dmPolicy`,
        allowFromPath: basePath,
        approveHint: formatPairingApproveHint(CHANNEL_ID),
        normalizeEntry: (raw) => normalizeOneBotUserId(raw),
      };
    },
    collectWarnings: ({ account }) => {
      const groupPolicy = account.config.groupPolicy ?? "allowlist";
      if (groupPolicy !== "open") return [];
      return [
        `- QQ groups: groupPolicy="open" allows any member to trigger the bot. Set channels.onebot.groupPolicy="allowlist" + channels.onebot.groupAllowFrom to restrict senders.`,
      ];
    },
  },
  setup: {
    resolveAccountId: ({ accountId }) => normalizeAccountId(accountId),
    applyAccountName: ({ cfg, accountId, name }) =>
      applyAccountNameToChannelSection({
        cfg: cfg as ClawdbotConfig,
        channelKey: CHANNEL_ID,
        accountId,
        name,
      }),
    validateInput: ({ cfg, accountId, input }) => {
      const resolved = resolveOneBotAccount({ cfg: cfg as ClawdbotConfig, accountId });
      const wsUrl = input.url?.trim() || resolved.wsUrl;
      if (!wsUrl) return "OneBot requires --url (WebSocket endpoint).";
      return null;
    },
    applyAccountConfig: ({ cfg, accountId, input }) => {
      const namedConfig = applyAccountNameToChannelSection({
        cfg: cfg as ClawdbotConfig,
        channelKey: CHANNEL_ID,
        accountId,
        name: input.name,
      });
      if (accountId === DEFAULT_ACCOUNT_ID) {
        return {
          ...namedConfig,
          channels: {
            ...namedConfig.channels,
            onebot: {
              ...namedConfig.channels?.onebot,
              enabled: true,
              ...(input.url ? { wsUrl: input.url } : {}),
              ...(input.accessToken ? { accessToken: input.accessToken } : {}),
            },
          },
        } as ClawdbotConfig;
      }
      return {
        ...namedConfig,
        channels: {
          ...namedConfig.channels,
          onebot: {
            ...namedConfig.channels?.onebot,
            enabled: true,
            accounts: {
              ...(namedConfig.channels?.onebot?.accounts ?? {}),
              [accountId]: {
                ...(namedConfig.channels?.onebot?.accounts?.[accountId] ?? {}),
                enabled: true,
                ...(input.url ? { wsUrl: input.url } : {}),
                ...(input.accessToken ? { accessToken: input.accessToken } : {}),
              },
            },
          },
        },
      } as ClawdbotConfig;
    },
  },
  messaging: {
    normalizeTarget: normalizeOneBotMessagingTarget,
    targetResolver: {
      looksLikeId: looksLikeOneBotTargetId,
      hint: formatOneBotTargetHint(),
    },
  },
  outbound: onebotOutbound,
  status: {
    defaultRuntime: {
      accountId: DEFAULT_ACCOUNT_ID,
      running: false,
      connected: false,
      lastStartAt: null,
      lastStopAt: null,
      lastError: null,
    },
    buildChannelSummary: ({ snapshot }) => ({
      configured: snapshot.configured ?? false,
      running: snapshot.running ?? false,
      connected: snapshot.connected ?? false,
      lastStartAt: snapshot.lastStartAt ?? null,
      lastStopAt: snapshot.lastStopAt ?? null,
      lastError: snapshot.lastError ?? null,
    }),
    buildAccountSnapshot: ({ account, runtime }) => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: account.configured,
      wsUrl: account.wsUrl,
      platform: account.platform,
      selfId: account.selfId,
      running: runtime?.running ?? false,
      connected: runtime?.connected ?? false,
      lastStartAt: runtime?.lastStartAt ?? null,
      lastStopAt: runtime?.lastStopAt ?? null,
      lastError: runtime?.lastError ?? null,
      lastInboundAt: runtime?.lastInboundAt ?? null,
      lastOutboundAt: runtime?.lastOutboundAt ?? null,
    }),
    collectStatusIssues: (accounts) =>
      accounts.flatMap((account) => {
        if (!account.configured) {
          return [
            {
              channel: CHANNEL_ID,
              accountId: account.accountId,
              kind: "config" as const,
              message: "Account not configured (missing wsUrl)",
            },
          ];
        }
        return [];
      }),
  },
  gateway: {
    startAccount: async (ctx) => {
      const account = ctx.account;
      if (!account.configured || !account.wsUrl) {
        throw new Error("OneBot wsUrl not configured");
      }
      ctx.log?.info(`[${account.accountId}] starting provider (${account.wsUrl})`);
      return monitorOneBotProvider({
        account,
        accountId: account.accountId,
        config: ctx.cfg,
        runtime: ctx.runtime,
        abortSignal: ctx.abortSignal,
        statusSink: (patch) => ctx.setStatus({ accountId: ctx.accountId, ...patch }),
      });
    },
  },
};
