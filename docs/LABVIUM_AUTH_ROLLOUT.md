# LabVium additional sign-in rollout

Status: design and configuration requirements, not an activated sign-in service.
The deployed app currently supports Sites-managed ChatGPT sign-in. A button for
an unconfigured provider must not be displayed as a working login option.

## Recommended first release

Use a dedicated managed identity service for Google, Microsoft and verified email sign-in.
Google covers many university Google Workspace accounts; email OTP/magic links
cover users without a supported social account. Microsoft is the next useful
provider for universities and research organisations using Microsoft 365.
GitHub is useful for technical research teams. Apple, Kakao and Naver can be
added when their developer app registrations and review requirements are met.
These are proposed options, not current production capabilities.

## Provider setup checklist

| Method | Required configuration before activation |
| --- | --- |
| Google | OAuth client, approved origins and exact callback URL, consent screen |
| Microsoft | Entra application, supported tenant policy, exact callback, credential |
| GitHub | OAuth application client/secret and exact callback |
| Apple | Developer configuration, Services ID, signing key, verified domain/callback |
| Kakao | Developer app, enabled login, REST key and exact callback |
| Naver | Developer app, client/secret and registered service/callback |
| Email OTP / magic link | Dedicated managed auth, production SMTP/domain authentication, redirects, resend/rate limits |

Keep provider client secrets and SMTP credentials server-side, configured through
runtime secrets, never in the frontend bundle or Git. Existing unrelated Life OS
auth resources must not be repurposed without an explicit service-scoping choice.

## Ownership and existing accounts

1. Preserve the current Sites identity and its D1/R2 owner keys. No data reset or
   migration is part of adding a sign-in provider.
2. An external identity must be verified server-side against its exact issuer,
   audience, signature, expiry and immutable subject. Browser JSON, email strings
   and arbitrary request headers are not identity proof.
3. Use a distinct issuer/subject namespace for new external identities. An email
   match must never grant access to an existing ChatGPT account's records.
4. To connect an external identity to existing research, require proof of both
   sessions with a short-lived, one-time server challenge, explicit confirmation
   and atomic account-link uniqueness checks. Show the account being linked.
5. Preserve workspace ownership, editor/viewer roles and permission revisions for
   every API and PDF operation. Link changes must not silently merge workspaces.
6. Session cookies must be Secure, HttpOnly, same-site scoped, short-lived and
   revocable. OAuth needs exact callbacks, state, nonce/PKCE as applicable and
   safe local return paths. Retain origin and CSRF protection for writes.

## Release acceptance

Verify provider sign-in and sign-out on desktop and iPad, two-device persistence,
invalid/replayed/expired tokens, callback/open-redirect rejection, account linking
and unlinking without record loss, and viewer/owner isolation. Enable a provider
in the UI only after its end-to-end flow passes with real configured credentials.

## Primary documentation

- Google: https://developers.google.com/identity/openid-connect/openid-connect
- Microsoft: https://learn.microsoft.com/en-us/entra/identity-platform/v2-protocols-oidc
- GitHub: https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps
- Apple: https://developer.apple.com/documentation/signinwithapplerestapi
- Kakao: https://developers.kakao.com/docs/latest/ko/kakaologin/common
- Naver: https://developers.naver.com/docs/login/overview/overview.md
- Supabase email: https://supabase.com/docs/guides/auth/auth-smtp
- Supabase linking: https://supabase.com/docs/guides/auth/auth-identity-linking
