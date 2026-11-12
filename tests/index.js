// node --test tests/ — точка входа для запуска всей папки: в Node 22+ аргумент-каталог разрешается как модуль, а не как набор тестов.
// Подключает все *.test.mjs рядом (новые тесты подхватываются сами).
const fs = require('node:fs'), path = require('node:path'), url = require('node:url');
for (const f of fs.readdirSync(__dirname).filter((n) => n.endsWith('.test.mjs')).sort()) import(url.pathToFileURL(path.join(__dirname, f)).href);
