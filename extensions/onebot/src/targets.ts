export type OneBotTarget =
  | { kind: "user"; userId: string }
  | { kind: "group"; groupId: string }
  | { kind: "channel"; guildId: string; channelId: string };

const PREFIX_RE = /^onebot:/i;

function normalizeRawTarget(input: string): string {
  const trimmed = input.trim();
  return trimmed.replace(PREFIX_RE, "");
}

function stripPrefix(input: string, prefix: string): string | null {
  const lowered = input.toLowerCase();
  if (!lowered.startsWith(prefix)) return null;
  return input.slice(prefix.length).trim();
}

export function parseOneBotTarget(input: string): OneBotTarget | null {
  const raw = normalizeRawTarget(input);
  if (!raw) return null;

  const userPrefixes = ["user:", "private:", "dm:", "qq:"];
  for (const prefix of userPrefixes) {
    const rest = stripPrefix(raw, prefix);
    if (rest) {
      return { kind: "user", userId: rest };
    }
  }

  const groupRest = stripPrefix(raw, "group:");
  if (groupRest) {
    return { kind: "group", groupId: groupRest };
  }

  const channelPrefixes = ["channel:", "guild:"];
  for (const prefix of channelPrefixes) {
    const rest = stripPrefix(raw, prefix);
    if (rest) {
      const parts = rest.split(/[/:]/).map((part) => part.trim()).filter(Boolean);
      if (parts.length < 2) return null;
      return { kind: "channel", guildId: parts[0], channelId: parts[1] };
    }
  }

  return null;
}

export function normalizeOneBotMessagingTarget(target: string): string {
  const parsed = parseOneBotTarget(target);
  if (!parsed) return target.trim();
  if (parsed.kind === "user") return `user:${parsed.userId}`;
  if (parsed.kind === "group") return `group:${parsed.groupId}`;
  return `channel:${parsed.guildId}:${parsed.channelId}`;
}

export function looksLikeOneBotTargetId(input: string): boolean {
  return Boolean(parseOneBotTarget(input));
}

export function formatOneBotTargetHint(): string {
  return "<user:ID|group:ID|channel:GUILD:CHANNEL>";
}

export function buildOneBotTargetFromEvent(params: {
  detailType: string;
  userId?: string | null;
  groupId?: string | null;
  guildId?: string | null;
  channelId?: string | null;
}): string | null {
  const detail = params.detailType.trim().toLowerCase();
  if (detail === "private" || detail === "user" || detail === "dm") {
    if (!params.userId) return null;
    return `user:${params.userId}`;
  }
  if (detail === "group") {
    if (!params.groupId) return null;
    return `group:${params.groupId}`;
  }
  if (detail === "channel") {
    if (!params.guildId || !params.channelId) return null;
    return `channel:${params.guildId}:${params.channelId}`;
  }
  return null;
}
