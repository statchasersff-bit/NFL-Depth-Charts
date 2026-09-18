#!/usr/bin/env bash
# Route + SEO sweep. Runs the plugin's routing/SEO code against WordPress stubs
# and prints what each URL would return. Requires php on PATH.
set -u
cd "$(dirname "$0")"

urls=(
  "/nfl/nfl-depth-charts/fantasy/"
  "/nfl/nfl-depth-charts/fantasy/houston-texans/"
  "/nfl/nfl-depth-charts/fantasy/dallas-cowboys/"
  "/nfl/nfl-depth-charts/fantasy/buffalo-bills/"
  "/nfl/nfl-depth-charts/fantasy/houston-texans/rb/"
  "/nfl/nfl-depth-charts/offense/houston-texans/"
  "/nfl/nfl-depth-charts/fantasy/not-a-real-team/"
  "/nfl/nfl-depth-charts/bogus-view/houston-texans/"
  "/nfl/nfl-depth-charts/fantasy/Houston-Texans"
  "/nfl/nfl-depth-charts/fantasy/?team=houston-texans"
  "/nfl-depth-charts-sitemap.xml"
)

for url in "${urls[@]}"; do
  php render-url.php "$url"
  echo
done

echo "=== H1 resolution across theme/Divi layouts ==="
php h1-test.php
