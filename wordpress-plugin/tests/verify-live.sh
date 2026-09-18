#!/usr/bin/env bash
# Verify the INITIAL server response for the depth-chart routes on a live site.
# curl never runs JavaScript, so everything it prints came from PHP.
#
#   ./verify-live.sh                          # defaults to https://statchasers.com
#   ./verify-live.sh https://staging.example.com
set -u
BASE="${1:-https://statchasers.com}"
TOOL="$BASE/nfl/nfl-depth-charts"

# Cache-busting is deliberate: we want the origin's answer, not a CDN copy.
CURL=(curl -sS --compressed -A "Mozilla/5.0 (compatible; SCDC-verify)" -H 'Cache-Control: no-cache')

head_tags() {
  "${CURL[@]}" "$1" \
    | grep -oiE '<title>[^<]*</title>|<meta[^>]+name="description"[^>]*>|<link[^>]+rel="canonical"[^>]*>|<h1[^>]*>[^<]*</h1>|<meta[^>]+property="og:(title|url)"[^>]*>' \
    | sed 's/^/    /'
}

status_of() { "${CURL[@]}" -o /dev/null -w '%{http_code}' "$1"; }

section() { printf '\n=== %s\n' "$1"; }

for team in houston-texans dallas-cowboys buffalo-bills; do
  url="$TOOL/fantasy/$team/"
  section "$url  [$(status_of "$url")]"
  head_tags "$url"
  "${CURL[@]}" -D - -o /dev/null "$url" | grep -iE '^(x-scdc-route|cf-cache-status|x-cache|x-litespeed-cache):' | sed 's/^/    /'
done

section "$TOOL/fantasy/  (parent — must keep its generic title)  [$(status_of "$TOOL/fantasy/")]"
head_tags "$TOOL/fantasy/"

section 'Invalid slugs must 404 (not 200, not a soft 404)'
for bad in not-a-real-team random-keyword houston-texans-2; do
  printf '    %s  %s/fantasy/%s/\n' "$(status_of "$TOOL/fantasy/$bad/")" "$TOOL" "$bad"
done

section 'Normalization must 301 to the clean URL'
for u in "$TOOL/fantasy/Houston-Texans" "$TOOL/fantasy/houston-texans" "$TOOL/fantasy/?team=houston-texans"; do
  printf '    %s -> %s\n' \
    "$("${CURL[@]}" -o /dev/null -w '%{http_code}' "$u")" \
    "$("${CURL[@]}" -o /dev/null -w '%{redirect_url}' "$u")"
done

section 'Sitemap'
printf '    %s  %s/nfl-depth-charts-sitemap.xml\n' "$(status_of "$BASE/nfl-depth-charts-sitemap.xml")" "$BASE"
printf '    <loc> entries: %s\n' "$("${CURL[@]}" "$BASE/nfl-depth-charts-sitemap.xml" | grep -c '<loc>')"
printf '    listed in Rank Math index: %s\n' \
  "$("${CURL[@]}" "$BASE/sitemap_index.xml" | grep -c 'nfl-depth-charts-sitemap')"

section 'Googlebot must be able to fetch the depth-chart data'
printf '    robots.txt uploads rules: %s\n' \
  "$("${CURL[@]}" "$BASE/robots.txt" | grep -iE 'wp-content|uploads' | tr '\n' ';' || echo none)"
