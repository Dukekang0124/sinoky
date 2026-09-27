/* CI 诊断：查某个 tag 的 apk.yml 运行与逐步结果（本机无 gh CLI / 无 GitHub token 时的替代方案）
 * 用法：NODE_TLS_REJECT_UNAUTHORIZED=0 node _internal/ci_probe.cjs [tag]
 *   例：node _internal/ci_probe.cjs v0.27.0
 * 说明：只读公开 API；私有仓库读不到「步骤日志」（403 Must have admin rights），但步骤结论可读。
 */
const https = require('https');
const TAG = process.argv[2] || '';
const REPO = 'Dukekang0124/sinoky';
function get(u){return new Promise((res,rej)=>{https.get(u,{headers:{'User-Agent':'node','Accept':'application/vnd.github+json'}},r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res({s:r.statusCode,b:d}));}).on('error',e=>rej(e));});}
(async()=>{
  const r=await get('https://api.github.com/repos/'+REPO+'/actions/runs?per_page=30');
  if(r.s!==200){console.log('runs http',r.s,r.b.slice(0,200));return;}
  const runs=JSON.parse(r.b).workflow_runs.filter(x=>x.name==='Build Sinoky APK');
  console.log('最近 '+runs.length+' 次 APK 构建：');
  runs.slice(0,6).forEach(x=>console.log('  RUN',x.id,'|',x.head_branch,'|',x.status,'/',x.conclusion,'| updated',x.updated_at));
  const run = TAG ? runs.find(x=>x.head_branch===TAG) : runs[0];
  if(!run){console.log('未找到 tag='+TAG+' 的运行');return;}
  console.log('\n== 运行 '+run.id+' ('+run.head_branch+') 逐步结果 ==');
  const jr=await get('https://api.github.com/repos/'+REPO+'/actions/runs/'+run.id+'/jobs');
  JSON.parse(jr.b).jobs.forEach(job=>{
    console.log('JOB',job.name,'|',job.status,'/',job.conclusion);
    (job.steps||[]).forEach(s=>console.log('  ',String(s.number).padStart(3),(s.conclusion==='success'?'PASS':String(s.conclusion||s.status).toUpperCase()),s.name));
  });
  console.log('\n注：步骤级日志需 admin 权限（403），本机无 token 时读不到。');
})();
