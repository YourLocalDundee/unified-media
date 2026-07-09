/**
 * Minimal ambient type declarations for `web-push` (v3.6.x).
 *
 * The `web-push` package ships no bundled types and the DefinitelyTyped
 * `@types/web-push` package is intentionally NOT added (web-push is the only
 * new dependency approved for this feature). This declares just the surface the
 * app uses: VAPID setup + `sendNotification`. Errors thrown by sendNotification
 * carry a numeric `statusCode` (404/410 = subscription gone) which we read via a
 * structural cast at the call site, so no error class is declared here.
 */
declare module 'web-push' {
  export interface PushSubscriptionKeys {
    p256dh: string
    auth: string
  }

  export interface WebPushSubscription {
    endpoint: string
    keys: PushSubscriptionKeys
  }

  export interface SendResult {
    statusCode: number
    body: string
    headers: Record<string, string>
  }

  export function setVapidDetails(subject: string, publicKey: string, privateKey: string): void

  export function sendNotification(
    subscription: WebPushSubscription,
    payload?: string | Buffer | null,
  ): Promise<SendResult>

  export function generateVAPIDKeys(): { publicKey: string; privateKey: string }
}
