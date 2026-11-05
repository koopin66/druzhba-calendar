const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const {runInNewContext}=require('node:vm');
const code=readFileSync(join(__dirname,'../public/theme.js'),'utf8');
function browser({saved,systemDark=false,blocked=false}={}) {
  const values=new Map([['druzhba-demo-v1:/docs/','existing booking data']]);
  if(saved)values.set('druzhba-theme:/docs/',saved);
  const listeners={},mediaListeners={};
  const media={matches:systemDark,addEventListener:(type,fn)=>mediaListeners[type]=fn};
  const meta={content:'',setAttribute:(key,value)=>meta[key]=value};
  const context={document:{currentScript:{src:'https://example.com/docs/theme.js'},documentElement:{dataset:{}},querySelector:()=>meta},
    localStorage:{getItem:key=>{if(blocked)throw Error('blocked');return values.get(key)||null;},setItem:(key,value)=>{if(blocked)throw Error('blocked');values.set(key,value);}},
    matchMedia:()=>media,URL,CustomEvent:class{constructor(type){this.type=type;}},dispatchEvent:event=>listeners[event.type]?.(event),addEventListener:(type,fn)=>listeners[type]=fn};
  runInNewContext(code,context);
  return {context,values,media,mediaListeners,listeners,meta,theme:context.DruzhbaTheme};
}
test('initial appearance follows the device and updates the browser bar',()=>{
  const b=browser({systemDark:true});assert.equal(b.theme.resolved,'dark');assert.equal(b.meta.content,'#181818');
  b.media.matches=false;b.mediaListeners.change();assert.equal(b.theme.resolved,'light');
});
test('an explicit choice survives reload and never modifies calendar storage',()=>{
  const b=browser({systemDark:true});b.theme.set('light');
  assert.equal(b.values.get('druzhba-theme:/docs/'),'light');
  assert.equal(b.values.get('druzhba-demo-v1:/docs/'),'existing booking data');
  const reloaded=browser({saved:b.values.get('druzhba-theme:/docs/'),systemDark:true});
  assert.equal(reloaded.theme.resolved,'light');
  reloaded.mediaListeners.change();assert.equal(reloaded.theme.resolved,'light');
});
test('switching back to automatic and changes from other tabs are applied',()=>{
  const b=browser({saved:'light',systemDark:true});b.theme.set('system');assert.equal(b.theme.resolved,'dark');
  b.listeners.storage({key:'druzhba-theme:/docs/',newValue:'light'});assert.equal(b.theme.resolved,'light');
  b.listeners.storage({key:'another-app',newValue:'dark'});assert.equal(b.theme.resolved,'light');
});
test('blocked storage and invalid saved values do not prevent opening the app',()=>{
  const b=browser({blocked:true});b.theme.set('dark');assert.equal(b.theme.resolved,'dark');
  assert.equal(browser({saved:'unexpected'}).theme.preference,'system');
});
