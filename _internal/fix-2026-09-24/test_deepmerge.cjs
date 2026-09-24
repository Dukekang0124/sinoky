/* P2-1 回归测试：验证 deepMergeState 的合并语义（与 index.html 内联实现保持一致）。
   运行：node _internal/fix-2026-09-24/test_deepmerge.cjs */
function deepMergeState(base, inc){
  if(!inc || typeof inc!=='object') return base;
  if(Array.isArray(inc)){
    if(!Array.isArray(base)) return inc.slice();
    var seen={}, out=base.slice();
    base.forEach(function(x){ seen[JSON.stringify(x)]=1; });
    inc.forEach(function(x){ var k=JSON.stringify(x); if(!seen[k]){ seen[k]=1; out.push(x); } });
    return out;
  }
  if(typeof base!=='object' || base===null || Array.isArray(base)) base={};
  for(var k in inc){
    var iv=inc[k];
    if(iv===null||iv===undefined) continue;
    if(typeof iv==='object'){ base[k]=deepMergeState(base[k], iv); }
    else { base[k]=iv; }
  }
  return base;
}

let pass=0, fail=0;
function eq(name, got, exp){
  const g=JSON.stringify(got), e=JSON.stringify(exp);
  if(g===e){ pass++; console.log('  ✓ '+name); }
  else { fail++; console.error('  ✗ '+name+'  got='+g+'  exp='+e); }
}

// 场景1：双设备不同场景练习 → 进度应并集而非覆盖
const local = { _ts:100, phrases:{A:[1,2],B:[3]}, nono:{weak:{x:1}}, dayDone:{'2026-08-30':true}, streak:5 };
const cloud = { _ts:200, phrases:{B:[3,4],C:[5]}, nono:{weak:{y:2}}, dayDone:{'2026-08-31':true}, streak:7 };
const m1 = deepMergeState(JSON.parse(JSON.stringify(local)), cloud);
eq('s1 _ts remote-wins', m1._ts, 200);
eq('s1 phrases union', m1.phrases, {A:[1,2],B:[3,4],C:[5]});
eq('s1 nested weak merge', m1.nono.weak, {x:1,y:2});
eq('s1 dayDone union', m1.dayDone, {'2026-08-30':true,'2026-08-31':true});
eq('s1 streak remote-wins', m1.streak, 7);

// 场景2：远端 null 不覆盖本地值
const m2 = deepMergeState(JSON.parse(JSON.stringify({lastDone:'2026-08-30'})), {lastDone:null});
eq('s2 null skip', m2.lastDone, '2026-08-30');

// 场景3：本地独有 key 保留 + 标量远端优先
const m3 = deepMergeState(JSON.parse(JSON.stringify({a:1,secret:99})), {a:2});
eq('s3 scalar remote-wins', m3.a, 2);
eq('s3 local-only preserved', m3.secret, 99);

// 场景4：顶层数组并集去重
const m4 = deepMergeState(JSON.parse(JSON.stringify({days:['2026-01-01']})), {days:['2026-01-01','2026-02-02']});
eq('s4 array union', m4.days, ['2026-01-01','2026-02-02']);

// 场景5：异常安全——inc 为 null 时直接返回 base，不抛
let threw=false; try { deepMergeState({a:1}, null); } catch(e){ threw=true; }
eq('s5 null inc no-throw', threw, false);

console.log('\n[test_deepmerge] '+pass+' passed, '+fail+' failed');
process.exit(fail?1:0);
