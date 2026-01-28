import type { ChannelOutboundAdapter, ClawdbotConfig } from "clawdbot/plugin-sdk";

import { resolveOneBotAccount } from "./accounts.js";
import type { OneBotMessageSegment, ResolvedOneBotAccount, OneBotSelf } from "./types.js";
import { parseOneBotTarget, formatOneBotTargetHint } from "./targets.js";
import { getOneBotClient } from "./client-registry.js";
import { getOneBotRuntime } from "./runtime.js";

const CHANNEL_ID = "onebot" as const;

function buildTextSegments(text: string): OneBotMessageSegment[] {
  return [{ type: "text", data: { text } }];
}

function resolveSelf(account: ResolvedOneBotAccount, fallback?: OneBotSelf | null): OneBotSelf | null {
  const platform = account.platform?.trim() || fallback?.platform;
  const userId = account.selfId?.trim() || fallback?.user_id;
  if (!platform && !userId) return null;
  return {
    ...(platform ? { platform } : {}),
    ...(userId ? { user_id: userId } : {}),
  };
}

export async function sendOneBotMessage(params: {
  account: ResolvedOneBotAccount;
  target: string;
  text: string;
}): Promise<{ channel: string; to: string }>{
  const parsed = parseOneBotTarget(params.target);
  if (!parsed) {
    throw new Error(`Invalid OneBot target. Use ${formatOneBotTargetHint()}`);
  }

  const client = getOneBotClient(params.account.accountId);
  if (!client) {
    throw new Error("OneBot client is not connected");
  }

  const trimmed = params.text.trim();
  if (!trimmed) {
    return { channel: CHANNEL_ID, to: params.target };
  }

  const message = buildTextSegments(trimmed);
  const request: Record<string, unknown> = {
    detail_type: parsed.kind === "user" ? "private" : parsed.kind === "group" ? "group" : "channel",
    message,
  };

  if (parsed.kind === "user") {
    request.user_id = parsed.userId;
  } else if (parsed.kind === "group") {
    request.group_id = parsed.groupId;
  } else {
    request.guild_id = parsed.guildId;
    request.channel_id = parsed.channelId;
  }

  const selfOverride = resolveSelf(params.account, client.getSelf());
  const response = await client.sendAction("send_message", request, {
    self: selfOverride ?? undefined,
  });

  if (response.status && response.status !== "ok") {
    throw new Error(response.message || `OneBot send_message failed (${response.status})`);
  }
  if (typeof response.retcode === "number" && response.retcode !== 0) {
    throw new Error(response.message || `OneBot send_message retcode ${response.retcode}`);
  }

  return { channel: CHANNEL_ID, to: params.target };
}

export const onebotOutbound: ChannelOutboundAdapter = {
  deliveryMode: "direct",
  chunker: (text, limit) => getOneBotRuntime().channel.text.chunkText(text, limit),
  chunkerMode: "text",
  textChunkLimit: 4000,
  resolveTarget: ({ to }) => {
    const normalized = to ? to.trim() : "";
    const parsed = parseOneBotTarget(normalized);
    if (!parsed) {
      return {
        ok: false,
        error: new Error(`Invalid OneBot target. Use ${formatOneBotTargetHint()}`),
      };
    }
    return { ok: true, to: normalized };
  },
  sendText: async ({ cfg, to, text, accountId }) => {
    const account = resolveOneBotAccount({ cfg: cfg as ClawdbotConfig, accountId });
    if (!account.configured) {
      throw new Error("OneBot account not configured (missing wsUrl)");
    }
    const tableMode = getOneBotRuntime().channel.text.resolveMarkdownTableMode({
      cfg: cfg as ClawdbotConfig,
      channel: CHANNEL_ID,
      accountId: account.accountId,
    });
    const message = getOneBotRuntime().channel.text.convertMarkdownTables(text ?? "", tableMode);
    return await sendOneBotMessage({
      account,
      target: to,
      text: message,
    });
  },
  sendMedia: async ({ cfg, to, text, mediaUrl, accountId }) => {
    const combined = [text, mediaUrl ? `Attachment: ${mediaUrl}` : ""]
      .filter((part) => Boolean(part && part.trim()))
      .join("\n\n");
    return await onebotOutbound.sendText({
      cfg,
      to,
      text: combined,
      accountId,
    });
  },
};
