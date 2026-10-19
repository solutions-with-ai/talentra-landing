import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalize,handle} from '../worker.js';
import {RECIPIENT,csvCell,entriesCSV,renderMail,deliver} from '../mail.js';
const valid={name:'Persona ficticia',email:'qa@example.test',consent:true};
test('normalizes an explicitly consented fictional entry',()=>{
  assert.equal(normalize({...valid,email:'QA@EXAMPLE.TEST'},{}).email,'qa@example.test');
});
for(const change of [{consent:false},{consent:'true'},{name:'x'},{email:'a..b@example.test'},{email:'.a@example.test'},{email:'a@-invalid.test'},{email:'qa@real.es'},{recipient:RECIPIENT},{company:'A\nB'},{source:'x'.repeat(81)}])
  test('rejects invalid or unexpected fields '+JSON.stringify(change),()=>assert.throws(()=>normalize({...valid,...change},{})));
test('public mode accepts real-format emails but not implicit consent',()=>assert.equal(normalize({...valid,email:'qa@example.com'},{WAITLIST_MODE:'public'}).email,'qa@example.com'));
test('CSV neutralizes hidden spreadsheet formulas',()=>{
  for(const value of ['=1',' +cmd','\t@evil','-cmd'])assert.ok(csvCell(value).startsWith("'"));
  assert.match(entriesCSV([{name:'"quoted"',email:'qa@example.test'}]),/""quoted""/);
});
test('branded HTML escapes input and contains plain alternative',()=>{
  const rendered=renderMail({kind:'signup',payload:JSON.stringify({name:'<script>attack</script>'})});
  assert.match(rendered.html,/Talentra/);assert.match(rendered.html,/&lt;script&gt;/);assert.doesNotMatch(rendered.html,/<script>/);
  assert.ok(rendered.text);assert.deepEqual(rendered.to,[RECIPIENT]);assert.doesNotMatch(rendered.html,/https?:\/\//);
});
test('export attachment preserves Unicode CSV bytes',()=>{
  const csv=entriesCSV([{name:'Ficticia Núñez',email:'qa@example.test'}]);
  const mail=renderMail({kind:'export',payload:JSON.stringify({count:1,csv})});
  assert.equal(Buffer.from(mail.attachments[0].content,'base64').toString('utf8'),csv);
  assert.match(mail.html,/1<\/strong> inscripción/);
});
test('disabled mail never contacts the provider',async()=>{
  assert.equal((await deliver({recipient:RECIPIENT},{},()=>assert.fail('unexpected network'))).state,'disabled');
});
for(const [status,expected] of [[401,'failed'],[403,'failed'],[429,'retry'],[500,'retry'],[200,'sent']])
  test('provider response '+status,async()=>{
    const job={id:'fake-id',recipient:RECIPIENT,kind:'signup',payload:JSON.stringify({name:'Fake'})};
    const result=await deliver(job,{MAIL_ENABLED:'true',RESEND_API_KEY:'fake-only'},async(url,options)=>{
      assert.equal(url,'https://api.resend.com/emails');assert.equal(options.headers['Idempotency-Key'],'talentra-fake-id');
      assert.deepEqual(JSON.parse(options.body).to,[RECIPIENT]);return new Response(JSON.stringify({id:'provider-id'}),{status});
    });assert.equal(result.state,expected);
  });
test('public config does not disclose server credentials or recipient',async()=>{
  const res=await handle(new Request('https://worker.test/api/waitlist/config'),{ADMIN_TOKEN:'private',RESEND_API_KEY:'private'});
  assert.equal(res.status,200);assert.doesNotMatch(await res.text(),/private|gmail|ADMIN_TOKEN/);
});
test('private reads reject missing and incorrect authorization before storage',async()=>{
  for(const token of ['', 'Bearer wrong']) {
    const res=await handle(new Request('https://worker.test/api/admin/waitlist',{headers:{Authorization:token}}),{ADMIN_TOKEN:'a'.repeat(64)});
    assert.equal(res.status,401);
  }
});
test('unapproved origin cannot submit',async()=>{
  const res=await handle(new Request('https://worker.test/api/waitlist',{method:'POST',headers:{Origin:'https://evil.test'}}),{ALLOWED_ORIGINS:'https://good.test'});
  assert.equal(res.status,403);assert.equal(res.headers.get('Access-Control-Allow-Origin'),null);
});

for(const [label,value] of [
  ['Unicode accents', {name:'Álex Núñez · QA'}],
  ['person without a company', {company:'',role:''}],
  ['long legitimate name', {name:'A'.repeat(160)}],
  ['HTML treated as data', {name:'<img src=x onerror=alert(1)>'}],
  ['spreadsheet formula treated as data', {company:' =SUM(1,1)'}],
]) test('accepts bounded fictional example: '+label,()=>assert.ok(normalize({...valid,...value},{})));

for(const [label,value] of [
  ['null',null],['array',[]],['numeric name',{...valid,name:42}],
  ['long name',{...valid,name:'A'.repeat(161)}],['long company',{...valid,company:'A'.repeat(161)}],
  ['long role',{...valid,role:'A'.repeat(81)}],['long need',{...valid,need:'A'.repeat(1001)}],
  ['control character',{...valid,name:'Test\u0000Name'}],['unsupported language',{...valid,language:'xx'}],
  ['forged consent date',{...valid,consent_at:'2026-01-01'}],['forged status',{...valid,status:'contacted'}],
]) test('rejects hostile or malformed example: '+label,()=>assert.throws(()=>normalize(value,{})));

test('preflight grants only the configured origin, without credentials',async()=>{
  for(const [origin,status] of [['https://good.test',204],['https://evil.test',403],['null',403]]) {
    const res=await handle(new Request('https://worker.test/api/waitlist',{method:'OPTIONS',headers:{Origin:origin}}),{ALLOWED_ORIGINS:'https://good.test'});
    assert.equal(res.status,status);assert.equal(res.headers.get('Access-Control-Allow-Credentials'),null);
    assert.equal(res.headers.get('Access-Control-Allow-Origin'),status===204?origin:null);
  }
});
