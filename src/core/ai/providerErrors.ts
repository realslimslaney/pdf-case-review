// Recognizing a plan's usage limit in a provider CLI's failure text, so the error can say so and
// offer the other provider. Best effort: the switch is offered on every failure regardless.

const USAGE_LIMIT_PATTERN =
  /usage limit|hit your limit|limit reached|reached your limit|rate limit|quota|resets? (at|in)|too many requests/i;

export function looksLikeUsageLimit(message: string): boolean {
  return USAGE_LIMIT_PATTERN.test(message);
}
