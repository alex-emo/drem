#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
SRC=assets/brand/dream-icon.svg
ROUND=assets/brand/dream-icon-rounded.svg
SYMBOL=assets/brand/dream-symbol.svg
BG='#050A14'

# Web
rsvg-convert -w 512 "$SRC" -o apps/web/public/icons/icon-512.png
rsvg-convert -w 192 "$SRC" -o apps/web/public/icons/icon-192.png
cp "$ROUND" apps/web/public/favicon.svg

# iOS 1024 opaque
rsvg-convert -w 1024 "$SRC" -o /tmp/dream-icon-1024.png
magick /tmp/dream-icon-1024.png -background "$BG" -alpha remove -alpha off \
  apps/mobile/ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png
rsvg-convert -w 2732 -h 2732 "$ROUND" -o /tmp/dream-splash-rounded.png
magick -size 2732x2732 "xc:$BG" \( /tmp/dream-splash-rounded.png -resize 640x640 \) -gravity center -composite \
  apps/mobile/ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732.png
cp apps/mobile/ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732.png \
  apps/mobile/ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732-1.png
cp apps/mobile/ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732.png \
  apps/mobile/ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732-2.png

# Android legacy + round
for spec in mdpi:48 hdpi:72 xhdpi:96 xxhdpi:144 xxxhdpi:192; do
  d=${spec%%:*}; s=${spec##*:}
  rsvg-convert -w "$s" -h "$s" "$ROUND" -o "apps/mobile/android/app/src/main/res/mipmap-$d/ic_launcher.png"
  magick "apps/mobile/android/app/src/main/res/mipmap-$d/ic_launcher.png" \
    \( -size "${s}x${s}" xc:black -fill white -draw "circle $((s/2)),$((s/2)) $((s/2)),0" \) \
    -alpha off -compose CopyOpacity -composite \
    "apps/mobile/android/app/src/main/res/mipmap-$d/ic_launcher_round.png"
done

# Android adaptive foreground
for spec in mdpi:108 hdpi:162 xhdpi:216 xxhdpi:324 xxxhdpi:432; do
  d=${spec%%:*}; s=${spec##*:}
  magick -background none -density 384 "$SYMBOL" -resize "x$((s*60/100))" -gravity center -extent "${s}x${s}" \
    "apps/mobile/android/app/src/main/res/mipmap-$d/ic_launcher_foreground.png"
done

# Android splash
for f in apps/mobile/android/app/src/main/res/drawable-port-*/splash.png \
         apps/mobile/android/app/src/main/res/drawable-land-*/splash.png; do
  w=$(identify -format '%w' "$f"); h=$(identify -format '%h' "$f")
  short=$((w<h?w:h)); icon=$((short*42/100))
  magick -size "${w}x${h}" "xc:$BG" \( /tmp/dream-splash-rounded.png -resize "${icon}x${icon}" \) -gravity center -composite "$f"
done
magick -size 480x320 "xc:$BG" \( /tmp/dream-splash-rounded.png -resize 134x134 \) -gravity center -composite \
  apps/mobile/android/app/src/main/res/drawable/splash.png

echo "icons generated"
