import type { ClawdbotConfig, ReplyPayload } from "clawdbot/plugin-sdk";
import {
  logInboundDrop,
  resolveControlCommandGate,
  resolveMentionGatingWithBypass,
} from "clawdbot/plugin-sdk";

import type { ResolvedOneBotAccount, OneBotMessageEvent, OneBotMessageSegment } from "./types.js";
import { getOneBotRuntime } from "./runtime.js";
import { buildOneBotTargetFromEvent } from "./targets.js";
import { normalizeOneBotUserId } from "./normalize.js";
import { OneBotClient } from "./ws-client.js";
import { deleteOneBotClient, setOneBotClient } from "./client-registry.js";
import { sendOneBotMessage } from "./outbound.js";

const CHANNEL_ID = "onebot" as const;

export type OneBotMonitorOptions = {
  account: ResolvedOneBotAccount;
  accountId: string;
  config: ClawdbotConfig;
  runtime: { log?: (message: string) => void; error?: (message: string) => void };
  abortSignal: AbortSignal;
  statusSink?: (patch: {
    running?: boolean;
    connected?: boolean;
    lastInboundAt?: number;
    lastOutboundAt?: number;
    lastError?: string | null;
  }) => void;
};

type NormalizedAllowlist = {
  entries: Set<string>;
  hasWildcard: boolean;
};

function normalizeAllowlist(entries?: Array<string | number>): NormalizedAllowlist {
  const normalized = new Set<string>();
  let hasWildcard = false;
  for (const entry of entries ?? []) {
    const raw = String(entry).trim();
    if (!raw) continue;
    if (raw === "*") {
      hasWildcard = true;
      continue;
    }
    normalized.add(normalizeOneBotUserId(raw).toLowerCase());
  }
  return { entries: normalized, hasWildcard };
}

function mergeAllowlists(...lists: Array<NormalizedAllowlist | undefined>): NormalizedAllowlist {
  const merged = new Set<string>();
  let hasWildcard = false;
  for (const list of lists) {
    if (!list) continue;
    if (list.hasWildcard) hasWildcard = true;
    for (const entry of list.entries) merged.add(entry);
  }
  return { entries: merged, hasWildcard };
}

function isAllowed(list: NormalizedAllowlist, senderId?: string | null): boolean {
  if (list.hasWildcard) return true;
  const candidate = senderId?.trim().toLowerCase();
  if (!candidate) return false;
  return list.entries.has(candidate);
}

function resolveGroupConfig(params: {
  groups?: Record<string, { enabled?: boolean; requireMention?: boolean }> | undefined;
  groupKey: string | null;
}) {
  const groups = params.groups ?? {};
  const allowlistEnabled = Object.keys(groups).length > 0;
  const groupKey = params.groupKey ?? "";
  const directConfig = groupKey ? groups[groupKey] : undefined;
  const wildcardConfig = groups["*"];
  const groupConfig = directConfig ?? wildcardConfig;
  const allowed =
    !allowlistEnabled ||
    Boolean(groupKey && Object.hasOwn(groups, groupKey)) ||
    Object.hasOwn(groups, "*");
  return { allowlistEnabled, allowed, groupConfig };
}

function resolveMessageText(event: OneBotMessageEvent): {
  rawText: string;
  segments: OneBotMessageSegment[];
} {
  const segments = Array.isArray(event.message) ? event.message : [];
  const alt = typeof event.alt_message === "string" ? event.alt_message.trim() : "";
  if (alt) return { rawText: alt, segments };

  const pieces = segments.map((segment) => {
    const data = segment.data ?? {};
    switch (segment.type) {
      case "text":
        return typeof data.text === "string" ? data.text : "";
      case "mention": {
        const userId = typeof data.user_id === "string" ? data.user_id : "";
        return userId ? `@${userId}` : "@mention";
      }
      case "mention_all":
        return "@all";
      default:
        return `<${segment.type}>`;
    }
  });

  return { rawText: pieces.join("").trim(), segments };
}

function resolveMentionSignals(params: {
  segments: OneBotMessageSegment[];
  selfId?: string | null;
}) {
  const selfId = params.selfId?.trim();
  let hasAnyMention = false;
  let mentionedSelf = false;
  for (const segment of params.segments) {
    if (segment.type === "mention_all") {
      hasAnyMention = true;
      mentionedSelf = true;
      continue;
    }
    if (segment.type === "mention") {
      hasAnyMention = true;
      const rawUserId = segment.data?.user_id;
      const userId = rawUserId != null ? String(rawUserId).trim() : null;
      if (selfId && userId && userId === selfId) {
        mentionedSelf = true;
      }
    }
  }
  return { hasAnyMention, mentionedSelf };
}

function resolveSenderName(event: OneBotMessageEvent): string | undefined {
  const record = event as Record<string, unknown>;
  const nickname = record["qq.nickname"];
  if (typeof nickname === "string" && nickname.trim()) return nickname.trim();
  const userName = record["user_name"];
  if (typeof userName === "string" && userName.trim()) return userName.trim();
  return undefined;
}

async function deliverOneBotReply(params: {
  payload: ReplyPayload;
  target: string;
  account: ResolvedOneBotAccount;
  statusSink?: (patch: { lastOutboundAt?: number }) => void;
}): Promise<void> {
  const { payload, target, account, statusSink } = params;
  const text = payload.text ?? "";
  const mediaUrls = payload.mediaUrls?.length
    ? payload.mediaUrls
    : payload.mediaUrl
      ? [payload.mediaUrl]
      : [];
  const mediaBlock = mediaUrls.length ? mediaUrls.map((url) => `Attachment: ${url}`).join("\n") : "";
  const combined = text.trim()
    ? mediaBlock
      ? `${text.trim()}\n\n${mediaBlock}`
      : text.trim()
    : mediaBlock;

  if (!combined.trim()) return;

  await sendOneBotMessage({
    account,
    target,
    text: combined,
  });
  statusSink?.({ lastOutboundAt: Date.now() });
}

async function handleOneBotMessage(params: {
  event: OneBotMessageEvent;
  account: ResolvedOneBotAccount;
  config: ClawdbotConfig;
  runtime: OneBotMonitorOptions["runtime"];
  statusSink?: OneBotMonitorOptions["statusSink"];
}): Promise<void> {
  const { event, account, config, runtime, statusSink } = params;
  const detailType = String(event.detail_type ?? "").trim().toLowerCase();
  if (!detailType) return;

  const senderId = event.user_id?.toString().trim() ?? "";
  if (!senderId) return;

  const selfId =
    event.self?.user_id?.toString().trim() || account.selfId?.trim() || null;
  if (selfId && senderId === selfId) return;

  const groupId = event.group_id?.toString().trim() || null;
  const guildId = event.guild_id?.toString().trim() || null;
  const channelId = event.channel_id?.toString().trim() || null;

  const target = buildOneBotTargetFromEvent({
    detailType,
    userId: senderId,
    groupId,
    guildId,
    channelId,
  });
  if (!target) return;

  const isGroup = detailType === "group" || detailType === "channel";
  const chatType = detailType === "channel" ? "channel" : isGroup ? "group" : "direct";
  const groupKey =
    detailType === "channel"
      ? target
      : detailType === "group"
        ? groupId
        : null;
  const conversationId = detailType === "channel" ? `${guildId}:${channelId}` : groupId ?? senderId;
  if (!conversationId) return;

  const { rawText, segments } = resolveMessageText(event);
  if (!rawText) return;

  statusSink?.({ lastInboundAt: Date.now() });

  const core = getOneBotRuntime();
  const allowTextCommands = core.channel.commands.shouldHandleTextCommands({
    cfg: config,
    surface: CHANNEL_ID,
  });
  const useAccessGroups = config.commands?.useAccessGroups !== false;

  const storeAllowFrom = await core.channel.pairing.readAllowFromStore(CHANNEL_ID).catch(() => []);
  const configAllowFrom = normalizeAllowlist(account.config.allowFrom);
  const configGroupAllowFrom = normalizeAllowlist(account.config.groupAllowFrom);
  const storeAllowList = normalizeAllowlist(storeAllowFrom);

  const effectiveAllowFrom = mergeAllowlists(configAllowFrom, storeAllowList);
  const baseGroupAllowFrom =
    account.config.groupAllowFrom && account.config.groupAllowFrom.length > 0
      ? configGroupAllowFrom
      : configAllowFrom;
  const effectiveGroupAllowFrom = mergeAllowlists(baseGroupAllowFrom, storeAllowList);

  if (isGroup) {
    const groupState = resolveGroupConfig({
      groups: account.config.groups,
      groupKey,
    });
    if (!groupState.allowed) {
      runtime.log?.(`onebot: drop group ${groupKey ?? conversationId} (not allowlisted)`);
      return;
    }
    if (groupState.groupConfig?.enabled === false) {
      runtime.log?.(`onebot: drop group ${groupKey ?? conversationId} (disabled)`);
      return;
    }

    const groupPolicy = account.config.groupPolicy ?? "allowlist";
    if (groupPolicy === "disabled") {
      runtime.log?.(`onebot: drop group ${groupKey ?? conversationId} (groupPolicy=disabled)`);
      return;
    }
    if (groupPolicy === "allowlist") {
      const allowed = isAllowed(effectiveGroupAllowFrom, senderId);
      if (!allowed) {
        runtime.log?.(
          `onebot: drop group sender ${senderId} (groupPolicy=allowlist, not allowed)`,
        );
        return;
      }
    }
  } else {
    const dmPolicy = account.config.dmPolicy ?? "pairing";
    if (dmPolicy === "disabled") {
      runtime.log?.(`onebot: drop DM sender ${senderId} (dmPolicy=disabled)`);
      return;
    }
    if (dmPolicy !== "open") {
      const allowed = isAllowed(effectiveAllowFrom, senderId);
      if (!allowed) {
        if (dmPolicy === "pairing") {
          const { code, created } = await core.channel.pairing.upsertPairingRequest({
            channel: CHANNEL_ID,
            id: senderId,
            meta: { name: resolveSenderName(event) },
          });
          if (created) {
            try {
              await sendOneBotMessage({
                account,
                target: `user:${senderId}`,
                text: core.channel.pairing.buildPairingReply({
                  channel: CHANNEL_ID,
                  idLine: `Your QQ user id: ${senderId}`,
                  code,
                }),
              });
              statusSink?.({ lastOutboundAt: Date.now() });
            } catch (err) {
              runtime.error?.(`onebot: pairing reply failed for ${senderId}: ${String(err)}`);
            }
          }
        }
        runtime.log?.(`onebot: drop DM sender ${senderId} (dmPolicy=${dmPolicy})`);
        return;
      }
    }
  }

  const allowForCommands = isGroup ? effectiveGroupAllowFrom : effectiveAllowFrom;
  const senderAllowedForCommands = isAllowed(allowForCommands, senderId);
  const hasControlCommand = core.channel.text.hasControlCommand(rawText, config);
  const commandGate = resolveControlCommandGate({
    useAccessGroups,
    authorizers: [{
      configured: allowForCommands.entries.size > 0 || allowForCommands.hasWildcard,
      allowed: senderAllowedForCommands,
    }],
    allowTextCommands,
    hasControlCommand,
  });

  if (isGroup && commandGate.shouldBlock) {
    logInboundDrop({
      log: (message) => runtime.log?.(message),
      channel: CHANNEL_ID,
      reason: "control command (unauthorized)",
      target: senderId,
    });
    return;
  }

  const route = core.channel.routing.resolveAgentRoute({
    cfg: config,
    channel: CHANNEL_ID,
    accountId: account.accountId,
    peer: {
      kind: isGroup ? (detailType === "channel" ? "channel" : "group") : "dm",
      id: conversationId,
    },
  });

  const mentionRegexes = core.channel.mentions.buildMentionRegexes(config, route.agentId);
  const mentionSignals = resolveMentionSignals({ segments, selfId });
  const textMentioned = mentionRegexes.length
    ? core.channel.mentions.matchesMentionPatterns(rawText, mentionRegexes)
    : false;
  const wasMentioned = mentionSignals.mentionedSelf || textMentioned;
  const canDetectMention = mentionRegexes.length > 0 || mentionSignals.hasAnyMention;

  const requireMention = isGroup
    ? core.channel.groups.resolveRequireMention({
        cfg: config,
        channel: CHANNEL_ID,
        groupId: groupKey ?? undefined,
        accountId: account.accountId,
        requireMentionOverride: account.requireMention,
      })
    : false;

  const mentionGate = resolveMentionGatingWithBypass({
    isGroup,
    requireMention: Boolean(requireMention),
    canDetectMention,
    wasMentioned,
    allowTextCommands,
    hasControlCommand,
    commandAuthorized: commandGate.commandAuthorized,
  });

  if (isGroup && mentionGate.shouldSkip) {
    runtime.log?.(`onebot: drop group ${groupKey ?? conversationId} (no mention)`);
    return;
  }

  const conversationLabel = isGroup
    ? detailType === "channel"
      ? `channel:${guildId ?? "unknown"}/${channelId ?? "unknown"}`
      : `group:${groupId ?? conversationId}`
    : `user:${senderId}`;

  const envelopeOptions = core.channel.reply.resolveEnvelopeFormatOptions(config);
  const body = core.channel.reply.formatAgentEnvelope({
    channel: "QQ",
    from: conversationLabel,
    timestamp: event.time ? event.time * 1000 : undefined,
    envelope: envelopeOptions,
    body: rawText,
  });

  const ctxPayload = core.channel.reply.finalizeInboundContext({
    Body: body,
    RawBody: rawText,
    CommandBody: rawText,
    From: `onebot:${target}`,
    To: `onebot:${target}`,
    SessionKey: route.sessionKey,
    AccountId: route.accountId,
    ChatType: chatType,
    ConversationLabel: conversationLabel,
    SenderName: resolveSenderName(event),
    SenderId: senderId,
    Provider: CHANNEL_ID,
    Surface: CHANNEL_ID,
    MessageSid: event.message_id,
    Timestamp: event.time ? event.time * 1000 : undefined,
    WasMentioned: isGroup ? mentionGate.effectiveWasMentioned : undefined,
    CommandAuthorized: commandGate.commandAuthorized,
    OriginatingChannel: CHANNEL_ID,
    OriginatingTo: `onebot:${target}`,
  });

  const storePath = core.channel.session.resolveStorePath(config.session?.store, {
    agentId: route.agentId,
  });
  await core.channel.session.recordInboundSession({
    storePath,
    sessionKey: ctxPayload.SessionKey ?? route.sessionKey,
    ctx: ctxPayload,
    onRecordError: (err) => {
      runtime.error?.(`onebot: failed updating session meta: ${String(err)}`);
    },
  });

  await core.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
    ctx: ctxPayload,
    cfg: config,
    dispatcherOptions: {
      deliver: async (payload) => {
        await deliverOneBotReply({
          payload,
          target,
          account,
          statusSink: statusSink ? (patch) => statusSink(patch) : undefined,
        });
      },
      onError: (err, info) => {
        runtime.error?.(`onebot ${info.kind} reply failed: ${String(err)}`);
      },
    },
    replyOptions: {
      disableBlockStreaming:
        typeof account.config.blockStreaming === "boolean"
          ? !account.config.blockStreaming
          : undefined,
    },
  });
}

export async function monitorOneBotProvider(options: OneBotMonitorOptions): Promise<{ stop: () => void }> {
  const { account, config, runtime, abortSignal, statusSink } = options;
  if (!account.wsUrl) {
    throw new Error("OneBot wsUrl not configured");
  }

  const core = getOneBotRuntime();
  const logger = core.logging.getChildLogger({ module: "onebot", accountId: account.accountId });

  const client = new OneBotClient({
    wsUrl: account.wsUrl,
    accessToken: account.accessToken,
    logger: {
      info: (message) => logger.info(message),
      warn: (message) => logger.warn(message),
      error: (message) => logger.error(message),
      debug: (message) => logger.debug?.(message),
    },
    abortSignal,
    onOpen: () => {
      statusSink?.({ connected: true, lastError: null });
    },
    onClose: () => {
      statusSink?.({ connected: false });
    },
    onError: (err) => {
      statusSink?.({ lastError: err.message });
    },
    onEvent: (event) => {
      if (event.self) {
        client.setSelf(event.self);
      }
      if (String(event.type ?? "") !== "message") return;
      void handleOneBotMessage({
        event: event as OneBotMessageEvent,
        account,
        config,
        runtime,
        statusSink,
      });
    },
  });

  setOneBotClient(account.accountId, client);
  client.start();

  const stop = () => {
    client.stop();
    deleteOneBotClient(account.accountId);
  };

  abortSignal.addEventListener("abort", stop, { once: true });
  await new Promise<void>((resolve) => {
    if (abortSignal.aborted) return resolve();
    abortSignal.addEventListener("abort", () => resolve(), { once: true });
  });

  return { stop };
}
