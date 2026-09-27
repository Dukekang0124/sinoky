/* dump_scenes.cjs —— 只读导出指定场景的句子（hz/py/en），用于 v0.27 场景教练的 checkpoint 复用既有内容。
   用法：node _internal/dump_scenes.cjs food transport */
const fs = require('fs');
const path = require('path');
const s = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const i = s.indexOf('var SCENES = [');
const j = s.indexOf('\nvar ', i + 20);
const code = s.slice(i, j);
const want = process.argv.slice(2);
const parts = code.split(/\{ id:'/).slice(1);
parts.forEach(function (p) {
  const id = p.slice(0, p.indexOf("'"));
  if (want.length && want.indexOf(id) < 0) return;
  console.log('#### ' + id);
  const pre = p.slice(p.indexOf('phrases:['));
  const re = /\{ en:'((?:[^'\\]|\\.)*)',[^}]*?py:'([^']*)', hz:'([^']*)'/g;
  let m;
  while ((m = re.exec(pre))) console.log('  ' + m[3] + '  |  ' + m[2] + '  |  ' + m[1]);
});
