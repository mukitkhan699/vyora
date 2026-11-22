# Google Search Console Setup for Zunari

Canonical public origin: `https://zunari.duckdns.org`

## What is already implemented

- Server-rendered public homepage: `https://zunari.duckdns.org/`
- Server-rendered public profiles: `https://zunari.duckdns.org/u/<username>`
- Server-rendered public posts: `https://zunari.duckdns.org/post/<post-id>`
- Dynamic sitemap: `https://zunari.duckdns.org/sitemap.xml`
- Robots file: `https://zunari.duckdns.org/robots.txt`
- Absolute HTTPS canonical, Open Graph, Twitter card, and JSON-LD metadata on public pages.
- `noindex` for the authenticated SPA, admin pages, login, API routes, and missing content.
- Suspended users and their posts are excluded from public pages and sitemaps.

The public pages are rendered by the Node.js backend using the existing PostgreSQL data. The existing
Vite/React application remains unchanged for signed-in users and is still served at `/login` and for
authenticated `/` requests.

## 1. Open Google Search Console

1. Go to <https://search.google.com/search-console>.
2. Sign in with the Google account that should own this property.

## 2. Add the URL-prefix property

1. Click **Add property**.
2. Choose **URL prefix**.
3. Enter exactly:

   ```text
   https://zunari.duckdns.org/
   ```

4. Continue to verification.

## 3. Verify ownership with the HTML tag method

1. On the verification screen, expand **HTML tag**.
2. Copy the full meta tag shown by Google. It looks like:

   ```html
   <meta name="google-site-verification" content="TOKEN_FROM_GOOGLE" />
   ```

3. Use only the `content` value from Google. Do not invent or reuse a token from another property.

## 4. Add the verification token to Zunari

The backend renders the verification meta tag on public pages when this environment variable is set:

```text
GOOGLE_SITE_VERIFICATION=TOKEN_FROM_GOOGLE
```

Set it in the existing Render environment for the Zunari web service, then redeploy. The project owner
must supply the real token; the repository intentionally contains no verification token.

Optional canonical origin override:

```text
SITE_ORIGIN=https://zunari.duckdns.org
```

`SITE_ORIGIN` defaults to `https://zunari.duckdns.org`. Localhost values are ignored so development
cannot accidentally publish localhost canonicals.

After redeploying, confirm the tag is present in the raw server response:

```bash
curl -s https://zunari.duckdns.org/ | grep google-site-verification
```

Then click **Verify** in Google Search Console. Do not consider ownership verified until Google reports
success.

## 5. Submit the sitemap

1. In Search Console, open **Sitemaps**.
2. Enter:

   ```text
   https://zunari.duckdns.org/sitemap.xml
   ```

3. Click **Submit**.

The sitemap is generated from PostgreSQL on each request. Newly published public posts and new profiles
appear automatically. Large content volumes are split into sitemap index files under
`https://zunari.duckdns.org/sitemaps/`.

## 6. Test URLs with URL Inspection

Use **URL Inspection** for each of these:

1. Homepage: `https://zunari.duckdns.org/`
2. A public profile: `https://zunari.duckdns.org/u/<existing-username>`
3. A public post: `https://zunari.duckdns.org/post/<existing-post-id>`

For each URL:

1. Paste the URL and press Enter.
2. Confirm Google reports the page as available.
3. Open **Test live URL**.
4. Confirm the rendered HTML contains the page title, description, canonical URL, and visible content.
5. Request indexing only after the page passes the live test.

Do not request indexing for private, missing, or suspended content.

## 7. Monitor indexing and troubleshoot

Check these reports regularly:

- **Pages** for indexed, excluded, and error states.
- **Sitemaps** for fetch status and discovered URL counts.
- **URL Inspection** for individual page status and live rendering.
- **Settings → Crawl stats** for Googlebot activity.

Common checks:

```bash
curl -I https://zunari.duckdns.org/
curl -I https://zunari.duckdns.org/robots.txt
curl -I https://zunari.duckdns.org/sitemap.xml
curl -s https://zunari.duckdns.org/robots.txt
curl -s https://zunari.duckdns.org/sitemap.xml | head
```

Expected behavior:

- Public pages return `200` and `index, follow`.
- Missing profiles and posts return `404` and `noindex, nofollow`.
- `robots.txt` allows `/`, `/assets/`, and `/api/files/`, and references the sitemap.
- `/api/`, `/admin/`, and `/login` are not intended for indexing.
- Database failures return `503` without exposing database details.

If a page is not indexed, first confirm it is publicly reachable without a session, then check that it
is listed in the sitemap, then use URL Inspection's live test.
