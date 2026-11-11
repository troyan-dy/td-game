"""tools/build_site.py [out] — статическая сборка игры для GitHub Pages (по умолчанию site/).
Копирует live/ без дев-инструментов, включает STATIC-режим (без опроса исходников и дев-оверлея)."""
import os, shutil, sys, json, re
out = sys.argv[1] if len(sys.argv) > 1 else 'site'
shutil.rmtree(out, ignore_errors=True); os.makedirs(os.path.join(out, 'assets'))
for f in os.listdir('live'):
    if f.endswith(('.js', '.css')) and not f.endswith('.cjs'): shutil.copy(os.path.join('live', f), out)
shutil.copytree('live/fonts', os.path.join(out, 'fonts'))
s = open('live/assets.js', encoding='utf-8').read(); A = json.loads(s[s.index('{'):s.rindex('}') + 1])
for n in A: shutil.copy(os.path.join('live/assets', n + '.png'), os.path.join(out, 'assets'))
html = open('live/index.html', encoding='utf-8').read().replace('<script>\n', '<script>window.__STATIC__ = 1;</script>\n<script>\n', 1)
open(os.path.join(out, 'index.html'), 'w', encoding='utf-8').write(html)
open(os.path.join(out, '.nojekyll'), 'w').close()
size = sum(os.path.getsize(os.path.join(dp, f)) for dp, _, fs in os.walk(out) for f in fs)
print(f'{out}: {len(A)} textures, {size / 1e6:.1f} MB')
