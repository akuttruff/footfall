#!/bin/sh
# One time: install the launchd agent (with the site's settings from the
# environment, so they stay out of the repo), build, start it, and serve it
# on the tailnet at :8447.
#
#   AWS_AMPLIFY_APP_ID=d1234abcd FOOTFALL_DOMAIN=example.com \
#   FOOTFALL_PROFILE=my-aws-profile sh scripts/install.sh
set -e
cd "$(dirname "$0")/.."
: "${AWS_AMPLIFY_APP_ID:?set AWS_AMPLIFY_APP_ID first (the Amplify app that hosts the site)}"
: "${FOOTFALL_DOMAIN:?set FOOTFALL_DOMAIN first (the domain of the site, e.g. example.com)}"
LABEL="${FOOTFALL_LABEL:-local.footfall}"
NPM="$(command -v npm)"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
sed -e "s|__LABEL__|$LABEL|" -e "s|__NPM__|$NPM|" -e "s|__DIR__|$(pwd)|" \
  -e "s|__PATH__|$(dirname "$NPM"):/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin|" \
  -e "s|__APP_ID__|$AWS_AMPLIFY_APP_ID|" -e "s|__DOMAIN__|$FOOTFALL_DOMAIN|" \
  -e "s|__PROFILE__|${FOOTFALL_PROFILE:-default}|" -e "s|__LOG__|$HOME/Library/Logs/$LABEL.log|g" \
  scripts/footfall.plist > "$PLIST"
npm run build
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
/Applications/Tailscale.app/Contents/MacOS/Tailscale serve --bg --https=8447 http://127.0.0.1:8610
echo "footfall: installed as $LABEL; on the tailnet at :8447"
