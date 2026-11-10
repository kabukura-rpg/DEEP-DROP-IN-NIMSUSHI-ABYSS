#!/bin/sh
# pubcheck.sh <local-dist> <out-dir>: every file of the local build manifest fetched from the public Pages URL, SHA-256 compared.
L="$1"; O="$2"; U=https://kabukura-rpg.github.io/DEEP-DROP-IN-NIMSUSHI-ABYSS
mkdir -p "$O/pub"; : > "$O/public-check.txt"; n=0; ok=0
for f in $(cd "$L" && find . -type f | sed 's#^\./##' | sort); do
  n=$((n+1)); mkdir -p "$O/pub/$(dirname "$f")"
  code=$(curl -s -o "$O/pub/$f" -w '%{http_code}' "$U/$f?nocache=$(date +%s)")
  a=$(shasum -a 256 "$L/$f" | cut -d' ' -f1); b=$(shasum -a 256 "$O/pub/$f" | cut -d' ' -f1)
  if [ "$code" = 200 ] && [ "$a" = "$b" ]; then ok=$((ok+1)); s=MATCH; else s=MISMATCH; fi
  echo "$s $code $a $f" >> "$O/public-check.txt"
done
code=$(curl -s -o "$O/pub/root.html" -w '%{http_code}' "$U/?nocache=$(date +%s)")
cmp -s "$O/pub/root.html" "$L/index.html" && r=MATCH || r=MISMATCH
echo "ROOT $code $r" >> "$O/public-check.txt"
echo "files=$n match=$ok root=$code/$r" | tee -a "$O/public-check.txt"
