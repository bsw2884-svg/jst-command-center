# JST Web Push one-time setup

Do not put the VAPID private key, Supabase service-role key, or webhook secret in Vite variables or committed files.

## 1. Apply the database migration

Run the complete contents of:

`supabase/migrations/20260826000200_web_push.sql`

This creates `push_subscriptions`, the protected `push_deliveries` outbox, and the notification-to-delivery trigger. It does not modify existing in-app notification rows.

## 2. Generate VAPID keys

Run this once on a trusted local machine:

```sh
npx web-push generate-vapid-keys --json
```

Keep the returned public and private keys paired. The private key must never be placed in frontend code.

## 3. Configure Vercel

In the Vercel project, open **Settings → Environment Variables** and add:

`VITE_VAPID_PUBLIC_KEY=<the generated public key>`

Add it to Production and Preview (and Development only if desired). A new Vercel build is required before the frontend can subscribe.

## 4. Configure Supabase Edge Function secrets

Use `https://jumpstarttomorrow.com/` as the VAPID contact subject. Generate a separate high-entropy webhook secret, for example with:

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Then configure the Edge Function secrets in one command:

```sh
supabase secrets set VAPID_PUBLIC_KEY="<public key>" VAPID_PRIVATE_KEY="<private key>" VAPID_SUBJECT="https://jumpstarttomorrow.com/" JST_PUSH_WEBHOOK_SECRET="<random webhook secret>" --project-ref qtmswcombdjsjprgbsyp
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are supplied to deployed Supabase Edge Functions by Supabase. Do not add the service-role key to Vercel.

## 5. Deploy the Edge Function

From the repository root:

```sh
supabase functions deploy send-web-push --project-ref qtmswcombdjsjprgbsyp --no-verify-jwt
```

JWT verification is disabled only because the database webhook authenticates with `x-jst-push-secret`. The function rejects calls without the matching secret.

## 6. Create the Database Webhook

This is a manual dashboard step because the webhook secret must not be committed in a migration.

1. Open the Supabase project dashboard.
2. Go to **Database → Webhooks → Create a new webhook**.
3. Name it `send-web-push-on-notification`.
4. Select table `public.notifications`.
5. Enable only the `INSERT` event.
6. Use HTTP method `POST`.
7. Set the URL to `https://qtmswcombdjsjprgbsyp.supabase.co/functions/v1/send-web-push`.
8. Add header `Content-Type: application/json`.
9. Add header `x-jst-push-secret: <the same JST_PUSH_WEBHOOK_SECRET>`.
10. Save and enable the webhook.

The webhook runs asynchronously after the notification row is created, so the original app mutation is not blocked by push delivery.

## 7. Device update steps after the feature is eventually deployed

- Close and reopen existing JST tabs/Home Screen instances so `/sw.js` updates from the former recovery worker to the persistent worker.
- A normal reload should be sufficient. The new worker uses network-only navigation and does not precache the app shell.
- On iPhone/iPad, launch JST from its Home Screen icon, then open **More → Settings / Data** and tap **Enable Push Notifications**. A normal Safari tab intentionally shows installation guidance instead.
- On Android or desktop Chrome/Edge, open **More → Settings / Data** and tap **Enable Push Notifications**.
- Reinstalling the PWA should only be needed if an old Home Screen installation fails to update after being fully closed and reopened.
