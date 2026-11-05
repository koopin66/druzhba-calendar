const {test}=require('node:test');
const assert=require('node:assert/strict');
const {webcrypto}=require('node:crypto');
const {createDemo}=require('../demo-runtime.js');
function fixture(){
  const values=new Map();
  const storage={getItem:key=>values.has(key)?values.get(key):null,setItem:(key,value)=>values.set(key,value)};
  const options={storage,now:()=>new Date('2026-11-05T09:00:00Z'),crypto:webcrypto};
  return {storage,options,api:createDemo(options).request};
}
const booking=(extra={})=>({title:'Тестовая группа',kind:'group',status:'confirmed',start:'2027-01-05T14:00',end:'2027-01-05T16:00',room_id:1,guests:26,exclusive:false,contact:'Вымышленный контакт',phone:'',notes:'Тест',...extra});
const occupy=api=>api('events',{method:'POST',body:booking({guests:46})});
test('new calendars are empty with two halls 72/55',async()=>{
  const {api}=fixture(),state=await api('state');
  assert.equal(state.local,true);assert.equal(state.demo,true);
  assert.deepEqual(state.rooms.map(r=>r.capacity),[72,55]);
  assert.equal(state.events.length,0);
  assert.equal(state.audit.length,0);
});
test('capacity rejects 27, permits exactly 26, persists after a new app instance',async()=>{
  const {api,options}=fixture();
  await occupy(api);
  await assert.rejects(api('events',{method:'POST',body:booking({guests:27})}),/Недостаточно/);
  const event=await api('events',{method:'POST',body:booking()});
  assert.equal((await createDemo(options).request('state')).events.find(e=>e.id===event.id).guests,26);
});
test('cancellation frees seats and stale edits are rejected',async()=>{
  const {api}=fixture();const event=await api('events',{method:'POST',body:booking()});
  const edited=await api('events/'+event.id,{method:'PUT',body:{...booking(),version:1,status:'cancelled'}});
  assert.equal(edited.version,2);
  await assert.rejects(api('events/'+event.id,{method:'PUT',body:{...booking(),version:1}}),/уже изменена/);
  assert.equal((await api('availability',{method:'POST',body:booking()})).available,true);
});
test('exclusive halls, adjacent events and separate rooms',async()=>{
  const {api}=fixture();
  await occupy(api);
  await assert.rejects(api('events',{method:'POST',body:booking({guests:1,exclusive:true})}),/занят/);
  assert.ok((await api('events',{method:'POST',body:booking({start:'2027-01-05T16:00',end:'2027-01-05T18:00',guests:72,exclusive:true})})).id);
  assert.ok((await api('events',{method:'POST',body:booking({room_id:2,guests:55,exclusive:true})})).id);
});
test('capacity uses peak, not sum of successive groups',async()=>{
  const {api}=fixture();
  await api('events',{method:'POST',body:booking({start:'2027-02-01T12:00',end:'2027-02-01T14:00',guests:50})});
  await api('events',{method:'POST',body:booking({start:'2027-02-01T14:00',end:'2027-02-01T16:00',guests:50})});
  assert.ok((await api('events',{method:'POST',body:booking({start:'2027-02-01T13:00',end:'2027-02-01T15:00',guests:22})})).id);
});
test('invalid calendar dates, duration and guest counts are rejected',async()=>{
  const {api}=fixture();
  for(const changes of [{start:'2027-02-30T14:00'},{end:'2027-01-05T13:00'},{guests:2.5},{guests:0},{end:'2027-01-08T16:00'}])
    await assert.rejects(api('events',{method:'POST',body:booking(changes)}));
});
test('room settings honor versions and occupied capacity',async()=>{
  const {api}=fixture();
  await occupy(api);
  await assert.rejects(api('rooms',{method:'POST',body:{id:1,name:'Зал',capacity:45,version:1}}),/больше гостей/);
  await api('rooms',{method:'POST',body:{id:1,name:'Большой зал',capacity:90,version:1}});
  assert.equal((await api('state')).rooms[0].capacity,90);
  await assert.rejects(api('rooms',{method:'POST',body:{id:1,name:'Старая версия',capacity:90,version:1}}),/изменены/);
});
test('storage failure is reported, never pretends a booking was saved',async()=>{
  const {api,storage}=fixture();await api('state');
  storage.setItem=()=>{throw new Error('quota');};
  await assert.rejects(api('events',{method:'POST',body:booking()}),/Не удалось сохранить/);
  assert.equal((await api('state')).events.length,0);
});
test('separate storage represents separate customer devices',async()=>{
  const a=fixture(),b=fixture();await a.api('events',{method:'POST',body:booking()});
  assert.equal((await a.api('state')).events.length,1);assert.equal((await b.api('state')).events.length,0);
});
test('backup and explicit reset stay local',async()=>{
  const {api}=fixture();await api('events',{method:'POST',body:booking()});
  assert.equal((await api('backup')).events.length,1);
  await api('reset',{method:'POST',body:{}});
  assert.equal((await api('state')).events.length,0);
  await assert.rejects(api('password',{method:'POST',body:{}}),/тестовой версии/);
});
test('existing requests, including cancelled ones, are cleared once without changing halls',async()=>{
  const {storage,api,options}=fixture();
  const old={schema:1,rooms:[{id:1,name:'Изменённый зал',capacity:72,version:2},{id:2,name:'Зал 2',capacity:55,version:1}],
    events:[{...booking(),id:'a'.repeat(24),version:1},{...booking({status:'cancelled'}),id:'b'.repeat(24),version:1}],
    audit:[{action:'Создана заявка',details:'Старая заявка'}]};
  storage.setItem('druzhba-demo-v1',JSON.stringify(old));
  const cleared=await api('state');
  assert.deepEqual(cleared.events,[]);assert.deepEqual(cleared.audit,[]);
  assert.equal(cleared.rooms[0].name,'Изменённый зал');
  const event=await api('events',{method:'POST',body:booking()});
  const reloaded=await createDemo(options).request('state');
  assert.equal(reloaded.events.length,1);assert.equal(reloaded.events[0].id,event.id);
});
test('explicit cleanup preserves room settings and does not restore examples',async()=>{
  const {api,options}=fixture();
  await api('rooms',{method:'POST',body:{id:1,version:1,name:'Большой зал',capacity:80}});
  await api('events',{method:'POST',body:booking()});
  await api('reset',{method:'POST',body:{}});
  const state=await createDemo(options).request('state');
  assert.equal(state.events.length,0);assert.equal(state.audit.length,0);
  assert.equal(state.rooms[0].name,'Большой зал');assert.equal(state.rooms[0].capacity,80);
});
