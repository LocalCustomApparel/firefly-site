#!/bin/bash
cd /var/www/ffsite

git fetch origin
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)

if [ "$LOCAL" != "$REMOTE" ]; then
  git reset --hard origin/main

  # reinstall deps if package.json changed
  if git diff --name-only "$LOCAL" "$REMOTE" | grep -q "^package.json$"; then
    npm install --production
  fi

  # Only restart the web process on boxes that run it — the tools droplet runs
  # scrape crons only (no ffsite PM2 process).
  pm2 describe ffsite >/dev/null 2>&1 && pm2 restart ffsite
  echo "$(date) — deployed $REMOTE" >> /var/log/ffsite-deploy.log
fi
