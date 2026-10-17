// Development only: synthetic identities and volatile records, never deploy this file.
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const { handleProfile } = await import(pathToFileURL(resolve(process.argv[2])).href);
const rows = new Map();
createServer(async (incoming, outgoing) => {
  try {
    const url = new URL(incoming.url, 'http://127.0.0.1');
    if (!url.pathname.startsWith('/functions/v1/app')) { outgoing.writeHead(404); outgoing.end(); return; }
    // Change the cookie using /functions/v1/app?fixture=A (or B/anonymous/error).
    const fixture = url.searchParams.get('fixture');
    if (fixture && ['A','B','anonymous','error'].includes(fixture) && incoming.method === 'GET') {
      outgoing.writeHead(200, { 'set-cookie': `sites_fixture=${fixture}; Path=/; SameSite=Strict`, 'content-type':'text/plain' });
      outgoing.end(`Local fixture: ${fixture}. Return to the page and Reload.`); return;
    }
    const who = /(?:^|;\s*)sites_fixture=(A|B|anonymous|error)(?:;|$)/.exec(incoming.headers.cookie ?? '')?.[1] ?? 'anonymous';
    const headers = new Headers({ 'content-type': incoming.headers['content-type'] ?? '' });
    if (who !== 'anonymous') headers.set('x-qoder-user-context', Buffer.from(JSON.stringify({user_id:`fixture-${who}`,site_id:'fixture-site',host_id:'fixture-host',name:`Fixture ${who}`,picture:'',session_expires_at:Math.floor(Date.now()/1000)+600})).toString('base64url'));
    let size = 0; const chunks=[];
    for await (const chunk of incoming) { size += chunk.length; if(size>2048) { outgoing.writeHead(413); outgoing.end(); return; } chunks.push(chunk); }
    const query = { select(){return this;}, eq(_column,id){this.id=id;return this;},
      upsert(value){this.value=value;return this;},
      async maybeSingle(){return {data:rows.get(this.id) ?? null,error:who==='error'?{}:null};},
      async single(){if(who==='error')return {data:null,error:{}};rows.set(this.value.user_id,this.value);return {data:this.value,error:null};} };
    const response = await handleProfile({request:new Request(url,{method:incoming.method,headers,...(incoming.method==='POST'?{body:Buffer.concat(chunks)}:{})}),supabase:{from:()=>query}});
    outgoing.writeHead(response.status,Object.fromEntries(response.headers));outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch { outgoing.writeHead(500); outgoing.end('Local fixture failure'); }
}).listen(Number(process.argv[3] ?? 8000),'127.0.0.1',function(){console.log(`Local synthetic profile API: http://127.0.0.1:${this.address().port}/functions/v1/app?action=profile`);});
