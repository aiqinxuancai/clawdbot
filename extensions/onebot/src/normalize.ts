const USER_PREFIX_RE = /^(onebot:)?(user:|private:|dm:|qq:)?/i;

export function normalizeOneBotUserId(input: string): string {
  return input.trim().replace(USER_PREFIX_RE, "");
}
