import type {
  BlockStreamingCoalesceConfig,
  DmPolicy,
  GroupPolicy,
  MarkdownConfig,
} from "clawdbot/plugin-sdk";
import type { GroupToolPolicyConfig } from "clawdbot/plugin-sdk";

export type OneBotGroupConfig = {
  name?: string;
  enabled?: boolean;
  requireMention?: boolean;
  tools?: GroupToolPolicyConfig;
};

export type OneBotAccountConfig = {
  name?: string;
  enabled?: boolean;
  markdown?: MarkdownConfig;
  wsUrl?: string;
  accessToken?: string;
  platform?: string;
  selfId?: string;
  requireMention?: boolean;
  dmPolicy?: DmPolicy;
  allowFrom?: Array<string | number>;
  groupAllowFrom?: Array<string | number>;
  groupPolicy?: GroupPolicy;
  groups?: Record<string, OneBotGroupConfig>;
  textChunkLimit?: number;
  chunkMode?: "length" | "newline";
  blockStreaming?: boolean;
  blockStreamingCoalesce?: BlockStreamingCoalesceConfig;
};

export type OneBotConfig = OneBotAccountConfig & {
  accounts?: Record<string, OneBotAccountConfig>;
  defaultAccount?: string;
};

export type ResolvedOneBotAccount = {
  accountId: string;
  name?: string;
  enabled: boolean;
  wsUrl?: string;
  accessToken?: string;
  platform?: string;
  selfId?: string;
  requireMention?: boolean;
  configured: boolean;
  config: OneBotAccountConfig;
};

export type OneBotSelf = {
  platform?: string;
  user_id?: string;
};

export type OneBotMessageSegment = {
  type: string;
  data?: Record<string, unknown>;
};

export type OneBotEventBase = {
  id?: string;
  time?: number;
  type?: string;
  detail_type?: string;
  sub_type?: string;
  self?: OneBotSelf;
};

export type OneBotMessageEvent = OneBotEventBase & {
  type?: "message" | string;
  message_id?: string;
  message?: OneBotMessageSegment[];
  alt_message?: string;
  user_id?: string;
  group_id?: string;
  guild_id?: string;
  channel_id?: string;
};

export type OneBotActionRequest = {
  action: string;
  params?: Record<string, unknown>;
  echo?: string;
  self?: OneBotSelf;
};

export type OneBotActionResponse = {
  status?: "ok" | "failed" | string;
  retcode?: number;
  data?: unknown;
  message?: string;
  echo?: string;
};
