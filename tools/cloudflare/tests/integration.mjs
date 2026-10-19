// Real SQLite executes the D1 SQL contract; this is not a claim of Cloudflare edge deployment.
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {handle,drain} from '../worker.js';

function fixture() {
  const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('../migrations/0001_waitlist.sql',import.meta.url),'utf8'));
  const prepare=sql=>{const bind=(...args)=>({first:async()=>db.prepare(sql).get(...args)||null,all:async()=>({results:db.prepare(sql).all(...args)}),run:async()=>({meta:db.prepare(sql).run(...args)})});return {bind,...bind()};};
  // D1 serializes atomic batches; preserve that contract in the SQLite adapter.
  let previous=Promise.resolve();
  const DB={prepare,batch:statements=>{
    const work=previous.then(async()=>{
      db.exec('BEGIN');try{const result=[];for(const s of statements)result.push(await s.run());db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}
    });previous=work.catch(()=>{});return work;
  }};
  const env={DB,ADMIN_TOKEN:'a'.repeat(64),RATE_LIMIT_SECRET:'b'.repeat(64),TURNSTILE_SECRET:'test-secret',ALLOWED_ORIGINS:'https://landing.test',ALLOWED_HOSTNAME:'landing.test',MAIL_ENABLED:'false'};
  const send=async(url)=>{
    assert.equal(url,'https://challenges.cloudflare.com/turnstile/v0/siteverify');
    return Response.json({success:true,hostname:'landing.test',action:'talentra_waitlist'});
  };
  const pending=[];const ctx={waitUntil:promise=>pending.push(promise)};
  const call=(path,method='GET',payload,authorized=true)=>handle(new Request('https://worker.test'+path,{method,headers:{Origin:'https://landing.test','Content-Type':'application/json',...(authorized?{Authorization:'Bearer '+env.ADMIN_TOKEN}:{})},...(payload?{body:JSON.stringify(payload)}:{})}),env,ctx,send);
  const data={name:'Ficticia Núñez',email:'qa@example.test',consent:true,turnstile_token:'fake-single-use'};
  return {db,env,call,data,pending,send};
}
test('signup → durable single row/job → admin filter/status/CSV → delete',async()=>{
  const f=fixture();try {
    for(let i=0;i<2;i++)assert.equal((await f.call('/api/waitlist','POST',f.data)).status,202);
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM entries').get().n,1);
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM mail_jobs').get().n,1);
    let list=await(await f.call('/api/admin/waitlist?q=Núñez')).json();assert.equal(list.total,1);
    const id=list.entries[0].id;
    assert.equal((await f.call('/api/admin/waitlist/'+id,'PATCH',{status:'contacted'})).status,200);
    list=await(await f.call('/api/admin/waitlist?status=new')).json();assert.equal(list.total,0);
    assert.match(await(await f.call('/api/admin/waitlist-export')).text(),/Ficticia Núñez/);
    assert.equal((await f.call('/api/admin/waitlist-export','POST')).status,503);
    assert.equal((await f.call('/api/admin/waitlist/'+id,'DELETE')).status,204);
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM mail_jobs').get().n,0);
  }finally{await Promise.all(f.pending);f.db.close();}
});
test('invalid challenge is rejected without storing a row',async()=>{
  const f=fixture();try {
    const req=new Request('https://worker.test/api/waitlist',{method:'POST',headers:{Origin:'https://landing.test','Content-Type':'application/json'},body:JSON.stringify(f.data)});
    const res=await handle(req,f.env,{},async()=>Response.json({success:true,hostname:'evil.test',action:'talentra_waitlist'}));
    assert.equal(res.status,403);assert.equal(f.db.prepare('SELECT count(*) AS n FROM entries').get().n,0);
  }finally{f.db.close();}
});
test('real SQL recovers a failed provider attempt and clears delivered payload',async()=>{
  const f=fixture();try {
    await f.call('/api/waitlist','POST',f.data);await Promise.all(f.pending);
    f.env.MAIL_ENABLED='true';f.env.RESEND_API_KEY='fake-only';
    await drain(f.env,async()=>new Response('{}',{status:503}));
    let job=f.db.prepare('SELECT * FROM mail_jobs').get();assert.equal(job.status,'pending');assert.equal(job.attempts,1);
    f.db.prepare('UPDATE mail_jobs SET available_at=0').run();
    await drain(f.env,async()=>Response.json({id:'provider-fake'}));
    job=f.db.prepare('SELECT * FROM mail_jobs').get();assert.equal(job.status,'sent');assert.equal(job.payload,'{}');
  }finally{f.db.close();}
});
test('third duplicate remains generic, fourth is rate limited',async()=>{
  const f=fixture();try {
    for(let i=0;i<3;i++)assert.equal((await f.call('/api/waitlist','POST',f.data)).status,202);
    const res=await f.call('/api/waitlist','POST',f.data);assert.equal(res.status,429);assert.ok(res.headers.get('Retry-After'));
  }finally{await Promise.all(f.pending);f.db.close();}
});

test('three concurrent duplicates create one entry and one alert',async()=>{
  const f=fixture();try {
    const responses=await Promise.all(Array.from({length:3},()=>f.call('/api/waitlist','POST',f.data)));
    assert.deepEqual(responses.map(r=>r.status),[202,202,202]);
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM entries').get().n,1);
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM mail_jobs').get().n,1);
  }finally{await Promise.all(f.pending);f.db.close();}
});

test('public mode fails closed without privacy identity',async()=>{
  const f=fixture();try {
    f.env.WAITLIST_MODE='public';
    assert.equal((await f.call('/api/waitlist','POST',f.data)).status,503);
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM entries').get().n,0);
  }finally{f.db.close();}
});

test('SQL-like filters remain bound values, not SQL or wildcard expansion',async()=>{
  const f=fixture();try {
    await f.call('/api/waitlist','POST',f.data);
    for(const q of ["' OR 1=1 --",'%', '_',"'; DROP TABLE entries; --"]) {
      assert.equal((await(await f.call('/api/admin/waitlist?q='+encodeURIComponent(q))).json()).total,0);
    }
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM entries').get().n,1);
    assert.equal((await f.call('/api/admin/waitlist?page=0')).status,422);
    assert.equal((await f.call('/api/admin/waitlist?status=forged')).status,422);
  }finally{await Promise.all(f.pending);f.db.close();}
});

for(const [label,contentType,content,status] of [
  ['truncated JSON','application/json','{"name":',400],
  ['wrong MIME','application/jsonp','{}',415],
  ['oversize body','application/json','x'.repeat(12001),413],
  ['UTF-8 BOM','application/json; charset=UTF-8','\ufeff'+JSON.stringify({name:'Ficticia QA',email:'bom@example.test',consent:true,turnstile_token:'fake'}),202],
  ['invalid UTF-8','application/json',new Uint8Array([255]),400],
]) test('request body boundary: '+label,async()=>{
  const f=fixture();try {
    const req=new Request('https://worker.test/api/waitlist',{method:'POST',headers:{Origin:'https://landing.test','Content-Type':contentType},body:content});
    const response=await handle(req,f.env,{},f.send);
    assert.equal(response.status,status);
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM entries').get().n,status===202?1:0);
  }finally{await Promise.all(f.pending);f.db.close();}
});

for(const check of [{success:false},{success:true,hostname:'landing.test',action:'wrong'},{success:true,hostname:'other.test',action:'talentra_waitlist'}])
  test('rejects mismatched or expired Turnstile validation '+JSON.stringify(check),async()=>{
    const f=fixture();try {
      const req=new Request('https://worker.test/api/waitlist',{method:'POST',headers:{Origin:'https://landing.test','Content-Type':'application/json'},body:JSON.stringify(f.data)});
      assert.equal((await handle(req,f.env,{},async()=>Response.json(check))).status,403);
      assert.equal(f.db.prepare('SELECT count(*) AS n FROM entries').get().n,0);
    }finally{f.db.close();}
  });

test('provider timeout preserves entry and safe retry diagnostic',async()=>{
  const f=fixture();try {
    await f.call('/api/waitlist','POST',f.data);await Promise.all(f.pending);
    f.env.MAIL_ENABLED='true';f.env.RESEND_API_KEY='fake-only';
    await drain(f.env,async()=>{throw new Error('private diagnostic must not be stored');});
    const row=f.db.prepare('SELECT * FROM mail_jobs').get();
    assert.equal(row.status,'pending');assert.equal(row.error,'ProviderUnknown');
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM entries').get().n,1);
  }finally{f.db.close();}
});

test('five public-mode examples persist separately and export coherent Unicode data',async()=>{
  const f=fixture();try {
    Object.assign(f.env,{WAITLIST_MODE:'public',PRIVACY_NAME:'Fictional QA Controller',PRIVACY_EMAIL:'privacy@example.test'});
    const cases=[
      {name:'Álex Núñez QA',company:'',role:''},
      {name:'Recruiter QA',company:'Equipo ficticio',role:'People'},
      {name:'Investigación QA',company:'Centro ficticio',role:'Docencia'},
      {name:'<script>ficticio</script>',company:' =SUM(1,1)',role:'QA'},
      {name:'A'.repeat(160),company:'Ejemplo límite',role:'QA'},
    ];
    for(const [i,example] of cases.entries()) {
      assert.equal((await f.call('/api/waitlist','POST',{...f.data,...example,email:`public-${i}@example.test`})).status,202);
    }
    const list=await(await f.call('/api/admin/waitlist')).json();
    assert.equal(list.total,5);assert.equal(list.counts.new,5);
    const csv=await(await f.call('/api/admin/waitlist-export')).text();
    assert.match(csv,/Álex Núñez QA/);assert.ok(csv.includes("'=SUM(1,1)"));
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM mail_jobs').get().n,5);
    assert.equal(list.mode,'public');
  }finally{await Promise.all(f.pending);f.db.close();}
});

test('storage transaction failure never announces success or leaks diagnostics',async()=>{
  const f=fixture();try {
    f.db.exec('DROP TABLE mail_jobs');
    const result=await f.call('/api/waitlist','POST',f.data);
    assert.equal(result.status,503);assert.deepEqual(await result.json(),{error:'unavailable'});
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM entries').get().n,0);
  }finally{f.db.close();}
});
