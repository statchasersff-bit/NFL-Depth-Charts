# Route + SEO test harness

Executes the plugin's routing and SEO code (`SCDC_Route`, `SCDC_SEO`,
`SCDC_Team_Content`, `SCDC_Sitemap`, `SCDC_Shortcode`) against a small set of
WordPress stubs, so the *initial server response* for any URL can be inspected
without a WordPress install.

```bash
./run-tests.sh                                              # full sweep
php render-url.php /nfl/nfl-depth-charts/fantasy/dallas-cowboys/
php render-url.php /nfl/nfl-depth-charts/fantasy/houston-texans/ body   # full markup
php h1-test.php                                             # H1 across layouts
```

- `wp-stubs.php` — minimal shims (hooks, escaping, options, permalinks). The
  simulated site is `https://statchasers.com`, the tool page is
  `/nfl/nfl-depth-charts/` (ID 42) under an `/nfl/` parent (ID 7).
- `render-url.php` — simulates the rewrite rules, runs the request lifecycle
  (`parse_request` → `wp` → `template_redirect`), then prints the status, route,
  head tags (Rank Math filters applied to deliberately *generic* input values),
  breadcrumbs, schema, H1s and the server-rendered markup.
- `fixtures/statchasers/depth-charts.json` — three teams of sample cached data so
  the "at a glance" summary has something real to render.

This is a harness, not the live site: it proves the plugin's own logic. After
deploying, confirm the real responses with `curl -sS <url> | grep -E '<title>|canonical|<h1'`.
