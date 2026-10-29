export const RECIPIENT = 'talentra.encuentratutalento@gmail.com';
export const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function csvCell(value) {
  const s=String(value ?? '');
  return /^[=+\-@]/.test(s.trimStart()) || /^[\t\r\n]/.test(s) ? "'"+s : s;
}
export function entriesCSV(rows) {
  const fields=['name','email','company','role','need','source','language','status','created_at','consent_at','consent_version'];
  return '\ufeff'+[fields,...rows.map(row=>fields.map(key=>csvCell(row[key])))].map(row=>row.map(s=>'"'+String(s).replace(/"/g,'""')+'"').join(',')).join('\r\n')+'\r\n';
}
export function renderMail(job) {
  const p=JSON.parse(job.payload), signup=job.kind==='signup';
  const subject=signup?'Talentra · Nueva inscripción en la lista de espera':'Talentra · Exportación privada de la lista de espera';
  const text=signup?`Nueva inscripción: ${p.name}\nConsulta Talentra → Lista de espera. El correo de la persona no está verificado.`:`Listado solicitado por un administrador: ${p.count} ${p.count===1?'inscripción':'inscripciones'}. Contiene datos personales; no lo reenvíes sin autorización.`;
  const content=signup?`<strong>${esc(p.name)}</strong> quiere conocer Talentra.`:`Tu exportación incluye <strong>${esc(p.count)}</strong> ${p.count===1?'inscripción':'inscripciones'}. Encontrarás el listado en el CSV adjunto.`;
  const html=`<!doctype html><html lang="es"><meta charset="utf-8"><body style="margin:0;background:#f6f7fb;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Arial,sans-serif;color:#27334b"><table role="presentation" width="100%" style="padding:32px 16px"><tr><td align="center"><table role="presentation" width="100%" style="max-width:580px;background:white;border:1px solid #e3e8f2;border-radius:20px"><tr><td style="padding:28px;border-bottom:1px solid #edf0f5"><span style="background:#ba285b;color:white;border-radius:12px;padding:10px;font-weight:800">T</span> <strong style="font-size:24px">Talentra</strong><p>El talento, más cerca.</p></td></tr><tr><td style="padding:28px"><h1 style="font-size:23px">${esc(subject)}</h1><p style="line-height:1.7">${content}</p><p style="background:#fff0f5;padding:16px;border-radius:12px;color:#8f254c">Consulta Talentra → Lista de espera para gestionar las inscripciones.</p><p style="font-size:12px;color:#536179">Notificación privada. No verifica la identidad del inscrito ni autoriza a reenviar sus datos.</p></td></tr></table></td></tr></table></body></html>`;
  const body={from:'Talentra <onboarding@resend.dev>',to:[RECIPIENT],subject,text,html};
  if(!signup) {
    const bytes=new TextEncoder().encode(p.csv);
    let binary=''; for(const byte of bytes) binary+=String.fromCharCode(byte);
    body.attachments=[{filename:'talentra-waitlist.csv',content:btoa(binary)}];
  }
  return body;
}
export async function deliver(job, env, send=fetch) {
  if(job.recipient!==RECIPIENT || env.MAIL_ENABLED!=='true' || !env.RESEND_API_KEY) return {state:'disabled'};
  const response=await send('https://api.resend.com/emails',{
    method:'POST',signal:AbortSignal.timeout(10000),
    headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':`talentra-${job.id}`},
    body:JSON.stringify(renderMail(job)),
  });
  if(!response.ok) return {state:response.status===429||response.status>=500?'retry':'failed',error:`ProviderHTTP${response.status}`};
  const data=await response.json();
  return typeof data.id==='string' && /^[\w-]{1,128}$/.test(data.id)?{state:'sent',id:data.id}:{state:'retry',error:'ProviderUnknown'};
}
