#!/bin/bash
# 使い方: cmp.sh <基準> <新> — 既知のちがい（?v= の数字、気分グラフの点の色）をならしてから比べる
n() { sed -E 's/\?v=[0-9]+//g; s/(<circle [^>]* r="(7|9|2\.4)") fill="[^"]*"/\1 fill="X"/g' "$1"; }
for f in $1/*.html $1/*.json; do b=$(basename $f)
  if [ ! -f $2/$b ]; then echo "MISSING $b"; continue; fi
  d=$(diff <(n $f) <(n $2/$b) | grep -c '^[<>]')
  [ "$d" != 0 ] && echo "DIFF $b $d"
done
for f in $2/*.html $2/*.json; do [ -f $1/$(basename $f) ] || echo "EXTRA $(basename $f)"; done
