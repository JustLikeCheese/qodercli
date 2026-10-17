// Dependency injection is only for local tests. index.ts retains Deno.serve.
// This module never consumes owner IDs, object paths or DB tokens from clients.
export function application({ db, storage, requireUser, BackendError }) {
  const uuid = v => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);
  const fail = (code, status) => { throw new BackendError(code, status); };
  const rows = result => { if (result.error) fail(result.error.code, result.error.status); return result.data; };
  async function input(request) {
    if (!request.headers.get('content-type')?.startsWith('application/json')) fail('invalid_input', 400);
    const reader = request.body?.getReader(); if (!reader) fail('invalid_input',400);
    let size=0; const chunks=[];
    try { while(true) { const {done,value}=await reader.read(); if(done)break; size+=value.length; if(size>8192){await reader.cancel();fail('payload_too_large',413);} chunks.push(value); } }
    finally { reader.releaseLock(); }
    const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    try { return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)); } catch { fail('invalid_input',400); }
  }
  async function ownedNote(id,user) {
    const found=rows(await db.from('notes').select('id,owner_id').eq('id',id).eq('owner_id',user.id).limit(1));
    if(!found?.length)fail('not_found',404);
  }
  async function verifyUpload(response) {
    const type=response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
    if(!response.ok||!response.body||!['image/png','image/jpeg','application/pdf'].includes(type)) {
      await response.body?.cancel(); fail('invalid_upload',422);
    }
    // Content-Length may be absent or misleading. Bound the bytes actually read.
    const reader=response.body.getReader(); let size=0, timedOut=false;
    const timer=setTimeout(()=>{timedOut=true;void reader.cancel().catch(()=>{});},15000);
    try {
      while(true) {
        const {done,value}=await reader.read();
        if(timedOut)fail('storage_unavailable',503);
        if(done)break;
        size+=value.byteLength;
        if(size>5*1024*1024)fail('invalid_upload',422);
      }
      if(size===0)fail('invalid_upload',422);
    } catch (error) {
      if(error instanceof BackendError)throw error;
      fail('storage_unavailable',503);
    } finally { clearTimeout(timer); await reader.cancel().catch(()=>{}); reader.releaseLock(); }
  }
  return async ctx => {
    const request=ctx.request;
    // Gateway preserves the suffix but replaces app with the deployment's
    // physical Function name. Provider may strip /functions/v1 before invocation.
    const pathname=new URL(request.url).pathname;
    const match=pathname.match(/^\/(?:functions\/v1\/)?(?:app|app-d[0-9a-f]{32})(\/.*)?$/);
    if(!match)fail('not_found',404);
    const path=match[1] || '/';
    if(path==='/api/health' && request.method==='GET') return Response.json({ok:true});
    const user=requireUser(ctx);
    if(path==='/api/me' && request.method==='GET') return Response.json({id:user.id});
    if(path==='/api/notes' && request.method==='GET') {
      return Response.json(rows(await db.from('notes').select('id,title,version,created_at').eq('owner_id',user.id).order('created_at',{ascending:false}).limit(100)));
    }
    if(path==='/api/notes' && request.method==='POST') {
      const body=await input(request);
      const key=request.headers.get('idempotency-key');
      if(!uuid(key)||typeof body?.title!=='string'||!body.title.trim()||body.title.length>300)fail('invalid_input',400);
      const inserted=rows(await db.from('notes').insertIfAbsent({owner_id:user.id,idempotency_key:key,title:body.title,creation_title:body.title},{onConflict:'owner_id,idempotency_key'}).select('id,title,version'));
      if(inserted?.length)return Response.json(inserted[0],{status:201});
      // A retry only recovers this exact command. Reusing a key for other input
      // conflicts rather than overwriting a previously committed business row.
      const existing=rows(await db.from('notes').select('id,title,version,creation_title').eq('owner_id',user.id).eq('idempotency_key',key).limit(1));
      if(!existing?.length||existing[0].creation_title!==body.title)fail('idempotency_conflict',409);
      return Response.json(existing[0]);
    }
    const note=path.match(/^\/api\/notes\/([0-9a-f-]{36})$/);
    if(note && uuid(note[1]) && request.method==='GET') {
      const found=rows(await db.from('notes').select('id,title,version,created_at').eq('id',note[1]).eq('owner_id',user.id).limit(1));
      if(!found?.length)fail('not_found',404);
      return Response.json(found[0]);
    }
    if(note && uuid(note[1]) && request.method==='PATCH') {
      const body=await input(request);
      if(typeof body?.title!=='string'||!body.title.trim()||body.title.length>300||!Number.isInteger(body.version)||body.version<1||body.version>=2147483647)fail('invalid_input',400);
      // Ownership and version are predicates of the write itself.
      const updated=rows(await db.from('notes').update({title:body.title,version:body.version+1}).eq('id',note[1]).eq('owner_id',user.id).eq('version',body.version).select('id,title,version'));
      if(!updated?.length)fail('write_conflict',409);
      return Response.json(updated[0]);
    }
    const uploads=path.match(/^\/api\/notes\/([0-9a-f-]{36})\/uploads$/);
    if(uploads && uuid(uploads[1]) && request.method==='GET') {
      await ownedNote(uploads[1],user);
      return Response.json(rows(await db.from('attachments').select('id,status,created_at').eq('note_id',uploads[1]).eq('owner_id',user.id).order('created_at',{ascending:false}).limit(100)));
    }
    if(uploads && uuid(uploads[1]) && request.method==='POST') {
      await ownedNote(uploads[1],user);
      const id=crypto.randomUUID(), objectPath=`attachments/${id}`;
      rows(await db.from('attachments').insert({id,note_id:uploads[1],owner_id:user.id,object_path:objectPath,status:'pending'}));
      const signed=await storage.createSignedUploadUrl(objectPath,{upsert:false});
      return Response.json({id,...signed},{status:201});
    }
    const attachment=path.match(/^\/api\/attachments\/([0-9a-f-]{36})\/(complete|download)$/);
    if(attachment && uuid(attachment[1]) && request.method==='POST') {
      const found=rows(await db.from('attachments').select('id,note_id,object_path,status').eq('id',attachment[1]).eq('owner_id',user.id).limit(1));
      if(!found?.length)fail('not_found',404);
      const file=found[0]; await ownedNote(file.note_id,user);
      if(attachment[2]==='complete') {
        // Do not trust the browser's completion claim. Verify the actual object.
        let uploaded;
        try { uploaded=await storage.download(file.object_path); }
        catch (error) { if (error?.code === 'storage_object_not_found') fail('upload_pending',409); throw error; }
        await verifyUpload(uploaded);
        rows(await db.from('attachments').update({status:'ready'}).eq('id',file.id).eq('owner_id',user.id).eq('status','pending'));
        return Response.json({id:file.id,status:'ready'});
      }
      if(file.status!=='ready')fail('upload_pending',409);
      return Response.json(await storage.createSignedUrl(file.object_path,60));
    }
    fail('not_found',404);
  };
}
