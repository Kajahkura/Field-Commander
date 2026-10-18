"""Run the compiled Rust WASM against a local SQLite Hrana protocol fixture.
This verifies the application/SDK wire, not the live BlinkHost runtime/provider.
Usage: python3 scripts/backend-check.py /path/to/field_commander_operations.wasm
"""
import sys,json,sqlite3,uuid,datetime
from pathlib import Path
import wasmtime
root=Path(__file__).resolve().parents[1]
db=sqlite3.connect(':memory:',isolation_level=None);db.executescript((root/'schema.sql').read_text())
engine=wasmtime.Engine();module=wasmtime.Module.from_file(engine,sys.argv[1]);owner='local-test-owner-key-'+'0'*45;generation=str(uuid.uuid4())
def typed(v):
 if v is None:return {'type':'null'}
 if isinstance(v,int):return {'type':'integer','value':str(v)}
 if isinstance(v,float):return {'type':'real','value':v}
 return {'type':'text','value':v}
def untyped(v):return None if v['type']=='null' else int(v['value']) if v['type']=='integer' else v['value']
last_native_calls=[0]
def request(body,token=owner,configured_generation=generation,native_unavailable=False):
 last_native_calls[0]=0
 store=wasmtime.Store(engine);wasi=wasmtime.WasiConfig();env=[('REQUEST_METHOD','POST'),('HTTP_REQ_AUTHORIZATION','Bearer '+token),('FIELD_WORKSPACE_ID','local-workspace'),('FIELD_DB_GENERATION',generation),('FIELD_DB_URL','https://fixture.turso.io'),('FIELD_DB_TOKEN','fixture-only'),('FIELD_DB_ID','fixture-database'),('FIELD_OWNER_KEY',owner),('FIELD_OWNER_NAME','Test Owner')];env=[(k,configured_generation if k=='FIELD_DB_GENERATION' else v) for k,v in env if k!='FIELD_DB_GENERATION' or configured_generation is not None];wasi.env=env;store.set_wasi(wasi);linker=wasmtime.Linker(engine);linker.define_wasi();raw=json.dumps(body).encode();output=[]
 def read(c,p,offset,capacity):
  b=raw[offset:offset+capacity];c.get('memory').write(c,b,p);return len(b)
 def write(c,p,length):output.append(json.loads(bytes(c.get('memory').read(c,p,p+length))));return length
 def fetch(c,p,length,out,capacity):
  v=json.loads(bytes(c.get('memory').read(c,p,p+length)));assert v['url']=='https://fixture.turso.io/v2/pipeline';assert v['headers']['authorization']=='Bearer fixture-only'
  steps=json.loads(v['body'])['requests'][0]['batch']['steps'];results=[];errors=[]
  def condition(v):
   if not v:return True
   if v['type']=='ok':return results[v['step']] is not None
   if v['type']=='not':return not condition(v['cond'])
   raise AssertionError(v)
  for step in steps:
   if not condition(step.get('condition')):results.append(None);errors.append(None);continue
   try:
    cursor=db.execute(step['stmt']['sql'],[untyped(a) for a in step['stmt']['args']]);rows=cursor.fetchall();results.append({'rows':[[typed(x) for x in row] for row in rows],'affected_row_count':max(0,cursor.rowcount)});errors.append(None)
   except sqlite3.Error as e:results.append(None);errors.append({'message':str(e)})
  response={'results':[{'type':'ok','response':{'type':'batch','result':{'step_results':results,'step_errors':errors}}},{'type':'ok','response':{'type':'close'}}]};b=json.dumps({'status':200,'headers':{},'body':json.dumps(response)}).encode();assert len(b)<=capacity;c.get('memory').write(c,b,out);return len(b)
 def native(c,p,length,out,capacity):
  last_native_calls[0]+=1
  v=json.loads(bytes(c.get('memory').read(c,p,p+length)));assert v['binding']=='DEFAULT'
  write=v['operation']['kind']=='transaction';req=v['operation']['request']
  if write:assert v['expected']=={'database_id':'fixture-database','generation':generation}
  results=[]
  try:
   if write:db.execute('BEGIN IMMEDIATE')
   for stmt in req['statements']:
    cur=db.execute(stmt['sql'],[untyped(a) for a in stmt.get('params',[])]);rows=cur.fetchall();affected=max(0,cur.rowcount)
    if 'expect_affected_rows' in stmt:assert affected==stmt['expect_affected_rows']
    results.append({'rows':[[typed(x) for x in row] for row in rows],'affected_rows':affected})
   if write:db.execute('COMMIT')
   response={'results':results,**({'outcome':'committed'} if write else {})}
  except (sqlite3.Error,AssertionError) as e:
   if write:db.execute('ROLLBACK')
   response={'results':[],'error':str(e),**({'outcome':'not_committed'} if write else {})}
  b=json.dumps({'database_id':None,'generation':None,'response':{'error':'native_binding_unavailable','results':[]}} if native_unavailable else {'database_id':'fixture-database','generation':generation,'response':response}).encode();assert len(b)<=capacity;c.get('memory').write(c,b,out);return len(b)
 for name,arity,fn in [('read_request',3,read),('write_response',2,write),('blinkhost_fetch',4,fetch),('database_v1',4,native)]:linker.define_func('blinkhost_system',name,wasmtime.FuncType([wasmtime.ValType.i32()]*arity,[wasmtime.ValType.i32()]),fn,access_caller=True)
 instance=linker.instantiate(store,module);instance.exports(store)['_start'](store);assert len(output)==1;return output[0]['status'],json.loads(output[0]['body'])
def ok(body,token=owner):
 status,v=request(body,token);assert status==200,(status,v);return v
assert request({'action':'login'},'invalid')[0]==401
ok({'action':'login'})
if any(i.name=='database_v1' for i in module.imports):
 assert request({'action':'login'},configured_generation=None)[0]==200
 assert request({'action':'login'},configured_generation='wrong-generation')[0]==503
 assert request({'action':'login'},native_unavailable=True)[0]==503
 assert request({'action':'login'},token='',native_unavailable=True)[0]==401
now=datetime.datetime.now(datetime.timezone.utc).isoformat();site={'id':str(uuid.uuid4()),'kind':'site','revision':1,'updatedAt':now,'name':'WASM test site','lat':9.1,'lon':7.4,'address':'','entrance':'West gate','contact':'','notes':''}
op={'id':str(uuid.uuid4()),'entity':site,'expectedRevision':0,'expectedGeneration':generation}
assert ok({'action':'mutate','operation':op})['entity']==site
assert ok({'action':'mutate','operation':op})['entity']==site
assert db.execute('SELECT COUNT(*) FROM fc_events').fetchone()[0]==1
bad={**op,'id':str(uuid.uuid4())};assert request({'action':'mutate','operation':bad})[0]==409
bad={**op,'id':str(uuid.uuid4()),'expectedGeneration':'old-generation'};assert request({'action':'mutate','operation':bad})[0]==409
member=ok({'action':'invite','name':'Test field member','role':'field'});key=member['key'];mid=member['member']['id'];assert ok({'action':'login'},key)['identity']['role']=='field'
assert request({'action':'mutate','operation':{**op,'id':str(uuid.uuid4()),'entity':{**site,'id':str(uuid.uuid4())}}},key)[0]==403
job={'id':str(uuid.uuid4()),'kind':'job','revision':1,'updatedAt':now,'title':'WASM delivery','siteId':site['id'],'assigneeId':mid,'status':'assigned','priority':'normal','dueAt':now,'vehicle':'Van','notes':'','outcome':'','evidence':[],'plannedAt':now}
jop={'id':str(uuid.uuid4()),'entity':job,'expectedRevision':0,'expectedGeneration':generation};ok({'action':'mutate','operation':jop})
update={'id':str(uuid.uuid4()),'entity':{**job,'revision':2,'status':'completed','outcome':'Delivered'},'expectedRevision':1,'expectedGeneration':generation};ok({'action':'mutate','operation':update},key)
if any(i.name=='database_v1' for i in module.imports):assert last_native_calls[0]==4,('field completion native round trips',last_native_calls[0])
unauthorized={**update,'id':str(uuid.uuid4()),'expectedRevision':2,'entity':{**update['entity'],'revision':3,'siteId':'other-site'}};assert request({'action':'mutate','operation':unauthorized},key)[0] in [400,403]
state=ok({'action':'state','cursor':''});assert len(state['entities'])==2
ok({'action':'revoke','id':mid});assert request({'action':'login'},key)[0]==401
print('PASS: compiled WASM request/response, database transactions, idempotent receipts, conflict and generation guards, field role permissions, assignment outcomes, pagination, revocation. Local fixture; live runtime not verified.')
