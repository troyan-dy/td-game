#!/usr/bin/env bash
# tools/genseq.sh — генерация строго по одной (image_gen у Codex обрывается ~на 120 с; параллель и quality high это провоцируют).
# Строки очереди: NAME|PROMPT|SIZE|ALPHA|REFS(через запятую)|FLAGS
export PYTHONUTF8=1 PYTHONIOENCODING=utf-8
GEN="C:/Users/Дмитрий/.claude/skills/ref2game/scripts/gen.py"
while IFS='|' read -r name prompt size alpha refs flags; do
  [ -z "$name" ] && continue
  for try in $(seq 1 ${TRIES:-3}); do
    [ -f "art/gen/$name.png" ] && break
    R=""; IFS=',' read -ra RR <<< "$refs"; for r in "${RR[@]}"; do [ -n "$r" ] && R="$R --ref $r"; done
    out=$(python "$GEN" one "$name" "$prompt" --size "$size" --alpha "$alpha" --quality medium $R $flags 2>&1 | grep -E "^\[$name\]" | tail -1)
    echo "$name try$try: ${out:-fail}"
  done
  [ -f "art/gen/$name.png" ] || echo "$name GAVE UP"
done < "$1"
echo QUEUE DONE
