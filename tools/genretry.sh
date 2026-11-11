#!/usr/bin/env bash
# tools/genretry.sh JOBS.json [jobs] — gen.py batch с повторами: image_gen у Codex иногда падает с сетевой ошибкой.
export PYTHONUTF8=1 PYTHONIOENCODING=utf-8
J="$1"; N="${2:-2}"; GEN="C:/Users/Дмитрий/.claude/skills/ref2game/scripts/gen.py"
for try in 1 2 3 4; do
  missing=$(python -c "import json,os,sys; print(' '.join(j['name'] for j in json.load(open(sys.argv[1],encoding='utf-8')) if not os.path.exists('art/gen/'+j['name']+'.png')))" "$J")
  [ -z "$missing" ] && { echo "ALL OK"; exit 0; }
  echo "try $try: $missing"
  python "$GEN" batch "$J" --jobs "$N" --skip-existing 2>&1 | grep -E "^\[|ok:|fail|error" | tail -20
done
python -c "import json,os,sys; m=[j['name'] for j in json.load(open(sys.argv[1],encoding='utf-8')) if not os.path.exists('art/gen/'+j['name']+'.png')]; print('MISSING', m if m else 'none')" "$J"
