import {
  BlockStreamingCoalesceSchema,
  DmPolicySchema,
  GroupPolicySchema,
  MarkdownConfigSchema,
  ToolPolicySchema,
  requireOpenAllowFrom,
} from "clawdbot/plugin-sdk";
import { z } from "zod";

const allowFromEntry = z.union([z.string(), z.number()]);

const OneBotGroupConfigSchema = z
  .object({
    name: z.string().optional(),
    enabled: z.boolean().optional(),
    requireMention: z.boolean().optional(),
    tools: ToolPolicySchema,
  })
  .strict();

const OneBotAccountSchemaBase = z
  .object({
    name: z.string().optional(),
    enabled: z.boolean().optional(),
    markdown: MarkdownConfigSchema,
    wsUrl: z.string().optional(),
    accessToken: z.string().optional(),
    platform: z.string().optional(),
    selfId: z.string().optional(),
    requireMention: z.boolean().optional(),
    dmPolicy: DmPolicySchema.optional().default("pairing"),
    allowFrom: z.array(allowFromEntry).optional(),
    groupAllowFrom: z.array(allowFromEntry).optional(),
    groupPolicy: GroupPolicySchema.optional().default("allowlist"),
    groups: z.record(z.string(), OneBotGroupConfigSchema.optional()).optional(),
    textChunkLimit: z.number().int().positive().optional(),
    chunkMode: z.enum(["length", "newline"]).optional(),
    blockStreaming: z.boolean().optional(),
    blockStreamingCoalesce: BlockStreamingCoalesceSchema.optional(),
  })
  .strict();

const OneBotAccountSchema = OneBotAccountSchemaBase.superRefine((value, ctx) => {
  requireOpenAllowFrom({
    policy: value.dmPolicy,
    allowFrom: value.allowFrom,
    ctx,
    path: ["allowFrom"],
    message:
      'channels.onebot.dmPolicy="open" requires channels.onebot.allowFrom to include "*"',
  });
});

export const OneBotConfigSchema = OneBotAccountSchemaBase.extend({
  accounts: z.record(z.string(), OneBotAccountSchema.optional()).optional(),
  defaultAccount: z.string().optional(),
}).superRefine((value, ctx) => {
  requireOpenAllowFrom({
    policy: value.dmPolicy,
    allowFrom: value.allowFrom,
    ctx,
    path: ["allowFrom"],
    message:
      'channels.onebot.dmPolicy="open" requires channels.onebot.allowFrom to include "*"',
  });
});
