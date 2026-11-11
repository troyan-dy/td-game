#!/usr/bin/env bash
# tools/refresh.sh — art/gen → live/assets (prep) → live/rigs.js → live/sizes.js. Страница перезагрузится сама.
export PYTHONUTF8=1 PYTHONIOENCODING=utf-8
python "C:/Users/Дмитрий/.claude/skills/ref2game/scripts/prep.py" | tail -1 && python tools/mkrigs.py && python tools/sizes.py > /dev/null && echo refreshed
