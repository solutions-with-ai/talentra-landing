import {RECIPIENT,deliver,entriesCSV} from './mail.js';

const states=new Set(['new','contacted','archived']);
const corsHeaders={'Access-Control-Allow-Methods':'GET, POST, PATCH, DELETE, OPTIONS','Access-Control-Allow-Headers':'Content-Type','Vary':'Origin'};
const json=(body,status=200,headers={})=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}});
class Problem extends Error { constructor(status,message){super(message);this.status=status;} }
const fail=(status,message)=>{throw new Problem(status,message);};
const all=async(db,sql,args=[]) => (await db.prepare(sql).bind(...args).all()).results;
const field=(data,key,max,required=false)=>{
  if(data[key]!==undefined && typeof data[key]!=='string') fail(422,'fields');
  const s=(data[key]||'').normalize('NFC').trim();
  if((required&&!s)||s.length>max||/[\u0000-\u001f\u007f]/.test(s)) fail(422,'fields');
  return s;
};
export function normalize(data,env) {
  if(!data||typeof data!=='object'||Array.isArray(data)) fail(422,'fields');
  const allowed=new Set(['name','email','company','role','need','source','language','consent','website','turnstile_token']);
  if(Object.keys(data).some(key=>!allowed.has(key))) fail(422,'fields');
  const name=field(data,'name',160,true),email=field(data,'email',254,true).toLowerCase();
  const [local,domain]=email.split('@');
  if(name.length<2 || !/^[a-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,63}$/.test(email)
    ||local.length>64||email.includes('..')||local.startsWith('.')||local.endsWith('.')
    ||domain.split('.').some(part=>!part||part.startsWith('-')||part.endsWith('-'))) fail(422,'fields');
  if(data.consent!==true) fail(422,'consent');
  if(env.WAITLIST_MODE!=='public' && !email.endsWith('@example.test')) fail(422,'fictional_only');
  const language=data.language||'es'; if(!['es','en'].includes(language)) fail(422,'fields');
  return {name,email,company:field(data,'company',160),role:field(data,'role',80),need:field(data,'need',1000),source:field(data,'source',80),language};
}
async function body(request) {
  if(request.headers.get('Content-Type')?.split(';',1)[0].trim().toLowerCase()!=='application/json') fail(415,'json_required');
  const reader=request.body?.getReader(); if(!reader) fail(400,'json');
  const parts=[];let size=0;
  try {
    for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>12000){await reader.cancel();fail(413,'size');}parts.push(value);}
    const bytes=new Uint8Array(size);let offset=0;for(const p of parts){bytes.set(p,offset);offset+=p.length;}
    return JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:false}).decode(bytes));
  } catch(e){if(e instanceof Problem)throw e;fail(400,'json');} finally {reader.releaseLock();}
}
async function hash(value){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');}
async function authorized(request,env) {
  const provided=request.headers.get('Authorization')||'';
  if(!env.ADMIN_TOKEN||env.ADMIN_TOKEN.length<32||provided.length>300) return false;
  const a=await hash(provided),b=await hash(`Bearer ${env.ADMIN_TOKEN}`);let different=0;
  for(let i=0;i<a.length;i++)different|=a.charCodeAt(i)^b.charCodeAt(i);
  return different===0;
}
async function limit(env,key,max,seconds) {
  if(!env.RATE_LIMIT_SECRET||env.RATE_LIMIT_SECRET.length<32) fail(503,'configuration');
  const now=Date.now(),digest=await hash(env.RATE_LIMIT_SECRET+':'+key);
  const row=await env.DB.prepare(`INSERT INTO limits(key,count,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN expires_at<=? THEN 1 ELSE count+1 END,expires_at=CASE WHEN expires_at<=? THEN excluded.expires_at ELSE expires_at END RETURNING count`).bind(digest,now+seconds*1000,now,now).first();
  if(row.count>max) fail(429,'rate_limit');
}
async function challenge(data,env,send) {
  const token=field(data,'turnstile_token',2048,true);
  if(!env.TURNSTILE_SECRET||!env.ALLOWED_HOSTNAME) fail(503,'configuration');
  let check;
  try {
    const res=await send('https://challenges.cloudflare.com/turnstile/v0/siteverify',{method:'POST',signal:AbortSignal.timeout(10000),body:new URLSearchParams({secret:env.TURNSTILE_SECRET,response:token})});
    if(!res.ok)fail(503,'challenge_unavailable');check=await res.json();
  }catch(e){if(e instanceof Problem)throw e;fail(503,'challenge_unavailable');}
  if(!check.success||check.hostname!==env.ALLOWED_HOSTNAME||check.action!=='talentra_waitlist')fail(403,'challenge');
}
function filters(url) {
  const q=url.searchParams.get('q')||'',status=url.searchParams.get('status')||'';
  if(q.length>160||status&&!states.has(status))fail(422,'filters');
  const page=Number(url.searchParams.get('page')||1);if(!Number.isInteger(page)||page<1||page>100000)fail(422,'page');
  const clauses=[],args=[];
  if(status){clauses.push('status=?');args.push(status);}
  if(q){const pattern='%'+q.replace(/[\\%_]/g,'\\$&')+'%';clauses.push("(name LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\' OR company LIKE ? ESCAPE '\\')");args.push(pattern,pattern,pattern);}
  return {where:clauses.length?' AND '+clauses.join(' AND '):'',args,page};
}
const visibleColumns='id,name,email,company,role,need,source,language,status,created_at,consent_at,consent_version';
export async function drain(env,send=fetch) {
  if(env.MAIL_ENABLED!=='true'||!env.RESEND_API_KEY)return;
  for(let n=0;n<5;n++) {
    const now=Date.now();
    const job=await env.DB.prepare(`UPDATE mail_jobs SET status='sending',attempts=attempts+1,lease_until=? WHERE id=(SELECT id FROM mail_jobs WHERE (status='pending' AND available_at<=? OR status='sending' AND lease_until<=?) ORDER BY created_at LIMIT 1) RETURNING *`).bind(now+60000,now,now).first();
    if(!job)break;
    let result;
    if(job.attempts>5||now-job.created_at>23*3600000)result={state:'failed',error:'RetryWindowExpired'};
    else {try{result=await deliver(job,env,send);}catch{result={state:'retry',error:'ProviderUnknown'};}}
    const status=result.state==='sent'?'sent':result.state==='failed'||job.attempts>=5?'failed':'pending';
    await env.DB.prepare('UPDATE mail_jobs SET status=?,provider_id=?,error=?,available_at=?,payload=?,lease_until=0 WHERE id=? AND status=\'sending\' AND lease_until=?').bind(status,result.id||null,result.error||null,now+Math.min(300000,10000*2**job.attempts),status==='pending'?job.payload:'{}',job.id,now+60000).run();
  }
}
export async function handle(request,env,ctx={},send=fetch) {
  const url=new URL(request.url),origin=request.headers.get('Origin')||'';
  const allowed=(env.ALLOWED_ORIGINS||'').split(',').map(s=>s.trim()).filter(Boolean).includes(origin);
  const cors=allowed?{...corsHeaders,'Access-Control-Allow-Origin':origin}:{};
  try {
    if(url.pathname==='/health') return json({status:'ok',configured:!!env.DB});
    if(url.pathname==='/api/waitlist/config'&&request.method==='GET')return json({mode:env.WAITLIST_MODE||'test',turnstile_site_key:env.TURNSTILE_SITE_KEY||'',privacy_name:env.PRIVACY_NAME||'',privacy_email:env.PRIVACY_EMAIL||'',retention_days:180},200,cors);
    if(url.pathname.startsWith('/api/admin/')) {
      if(!await authorized(request,env))return json({error:'unauthorized'},401);
      if(!env.DB)fail(503,'storage');
      const f=filters(url),now=Date.now();
      if(url.pathname==='/api/admin/waitlist'&&request.method==='GET') {
        const entries=await all(env.DB,`SELECT ${visibleColumns} FROM entries WHERE expires_at>?${f.where} ORDER BY created_at DESC,id LIMIT 25 OFFSET ?`,[now,...f.args,(f.page-1)*25]);
        const total=await env.DB.prepare(`SELECT count(*) AS n FROM entries WHERE expires_at>?${f.where}`).bind(now,...f.args).first();
        const counts=Object.fromEntries((await all(env.DB,'SELECT status,count(*) AS n FROM entries WHERE expires_at>? GROUP BY status',[now])).map(r=>[r.status,r.n]));
        const mail=await all(env.DB,'SELECT id,kind,status,attempts,error FROM mail_jobs ORDER BY created_at DESC LIMIT 10');
        return json({entries,total:total.n,page:f.page,page_size:25,counts,mode:env.WAITLIST_MODE||'test',mail_mode:env.MAIL_ENABLED==='true'?'resend':'disabled',recipient:RECIPIENT,mail,backend:'cloudflare'});
      }
      if(url.pathname==='/api/admin/waitlist-export'&&['GET','POST'].includes(request.method)) {
        const rows=await all(env.DB,`SELECT ${visibleColumns} FROM entries WHERE expires_at>?${f.where} ORDER BY created_at,id LIMIT 10001`,[now,...f.args]);
        if(rows.length>10000)fail(413,'narrow_filters');
        const csv=entriesCSV(rows);
        if(new TextEncoder().encode(csv).length>1048576)fail(413,'narrow_filters');
        if(request.method==='GET')return new Response(csv,{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="talentra-waitlist.csv"','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
        if(!rows.length)fail(409,'empty');
        if(env.MAIL_ENABLED!=='true')fail(503,'mail_disabled');
        await limit(env,'admin-export',5,3600);
        const id=crypto.randomUUID();
        await env.DB.prepare('INSERT INTO mail_jobs(id,kind,recipient,payload,created_at,available_at) VALUES(?,?,?,?,?,?)').bind(id,'export',RECIPIENT,JSON.stringify({count:rows.length,csv}),now,now).run();
        ctx.waitUntil?.(drain(env,send));return json({status:'queued',id,count:rows.length},202);
      }
      const match=url.pathname.match(/^\/api\/admin\/waitlist\/([a-f0-9-]{36})$/);
      if(match&&['PATCH','DELETE'].includes(request.method)) {
        const row=await env.DB.prepare(`SELECT ${visibleColumns} FROM entries WHERE id=? AND expires_at>?`).bind(match[1],now).first();if(!row)fail(404,'not_found');
        if(request.method==='DELETE') {
          // Do not race an in-flight send: the administrator can retry after its lease ends.
          const sending=await env.DB.prepare("SELECT id FROM mail_jobs WHERE (entry_id=? OR kind='export') AND status='sending' AND lease_until>? LIMIT 1").bind(row.id,now).first();
          if(sending)fail(409,'sending');
          const guard="NOT EXISTS(SELECT 1 FROM mail_jobs WHERE (entry_id=? OR kind='export') AND status='sending' AND lease_until>?)";
          await env.DB.batch([
            env.DB.prepare(`DELETE FROM mail_jobs WHERE kind='export' AND status='pending' AND ${guard}`).bind(row.id,now),
            env.DB.prepare(`DELETE FROM mail_jobs WHERE entry_id=? AND ${guard}`).bind(row.id,row.id,now),
            env.DB.prepare(`DELETE FROM entries WHERE id=? AND ${guard}`).bind(row.id,row.id,now),
          ]);
          if(await env.DB.prepare('SELECT id FROM entries WHERE id=?').bind(row.id).first())fail(409,'sending');
          return new Response(null,{status:204,headers:{'Cache-Control':'no-store'}});
        }
        const update=await body(request);if(!update||Object.keys(update).length!==1||!states.has(update.status))fail(422,'status');
        await env.DB.prepare('UPDATE entries SET status=? WHERE id=?').bind(update.status,row.id).run();return json({...row,status:update.status});
      }
      fail(404,'not_found');
    }
    if(request.method==='OPTIONS')return new Response(null,{status:allowed?204:403,headers:cors});
    if(url.pathname!=='/api/waitlist'||request.method!=='POST')fail(404,'not_found');
    if(!allowed)fail(403,'origin');
    if(!env.DB)fail(503,'storage');
    if(env.WAITLIST_MODE==='public'&&(!env.PRIVACY_NAME||!env.PRIVACY_EMAIL))fail(503,'privacy_configuration');
    await limit(env,'ip:'+(request.headers.get('CF-Connecting-IP')||'unknown'),20,3600);
    const data=await body(request),entry=normalize(data,env);
    if(field(data,'website',200))return json({status:'received'},202,cors);
    await limit(env,'email:'+entry.email,3,86400);
    await challenge(data,env,send);
    const now=Date.now(),id=crypto.randomUUID(),created=new Date(now).toISOString();
    // Atomic insert + insert-select: an existing email never generates another alert.
    await env.DB.batch([
      env.DB.prepare('INSERT OR IGNORE INTO entries(id,email,name,company,role,need,source,language,created_at,consent_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').bind(id,entry.email,entry.name,entry.company,entry.role,entry.need,entry.source,entry.language,created,created,now+180*86400000),
      env.DB.prepare('INSERT INTO mail_jobs(id,entry_id,kind,recipient,payload,created_at,available_at) SELECT ?,id,?,?,?,?,? FROM entries WHERE id=?').bind(crypto.randomUUID(),'signup',RECIPIENT,JSON.stringify({name:entry.name}),now,now,id),
    ]);
    ctx.waitUntil?.(drain(env,send));return json({status:'received'},202,cors);
  } catch(e){return json({error:e instanceof Problem?e.message:'unavailable'},e instanceof Problem?e.status:503,{...cors,...(e.status===429?{'Retry-After':'3600'}:{})});}
}
export default {
  fetch:handle,
  async scheduled(event,env,ctx) {
    ctx.waitUntil((async()=>{
      const now=Date.now();
      await env.DB.batch([
        env.DB.prepare('DELETE FROM limits WHERE expires_at<?').bind(now),
        env.DB.prepare("DELETE FROM mail_jobs WHERE created_at<? AND status IN ('sent','failed')").bind(now-7*86400000),
        env.DB.prepare("UPDATE mail_jobs SET status='failed',payload='{}',error='RetryWindowExpired' WHERE created_at<? AND status='pending'").bind(now-23*3600000),
        env.DB.prepare("DELETE FROM mail_jobs WHERE kind='export' AND status='pending' AND EXISTS(SELECT 1 FROM entries WHERE expires_at<?)").bind(now),
        env.DB.prepare("DELETE FROM entries WHERE expires_at<? AND NOT EXISTS(SELECT 1 FROM mail_jobs WHERE status='sending' AND lease_until>?)").bind(now,now),
      ]);
      await drain(env);
    })());
  },
};
