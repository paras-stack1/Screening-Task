/** Turns any thrown value into a safe, displayable message (no stack traces in the UI). */
export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return 'Unknown error';
}
