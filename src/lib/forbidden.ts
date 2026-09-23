/**
 * A signed-in user asked for something their membership doesn't allow. Server
 * actions surface the message as-is; pages catch it and redirect.
 *
 * It lives in its own module so `action-result` can recognise it without
 * importing `@/lib/household`, which pulls in next-auth.
 */
export class ForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ForbiddenError";
  }
}
