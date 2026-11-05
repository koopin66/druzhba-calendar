/* Apply the chosen appearance before the stylesheet paints the first frame. */
(function (global) {
  'use strict';
  const document=global.document;
  const key='druzhba-theme:'+new URL('./',document.currentScript.src).pathname;
  const system=global.matchMedia('(prefers-color-scheme: dark)');
  const valid=value=>['light','dark','system'].includes(value);
  let preference='system';
  try {const saved=global.localStorage.getItem(key);if(valid(saved))preference=saved;}catch{}
  function apply() {
    const resolved=preference==='system'?(system.matches?'dark':'light'):preference;
    document.documentElement.dataset.theme=resolved;
    const meta=document.querySelector('meta[name="theme-color"]');
    if(meta)meta.setAttribute('content',resolved==='dark'?'#181818':'#f6f7f4');
    global.dispatchEvent(new global.CustomEvent('druzhba-themechange'));
  }
  global.DruzhbaTheme={
    get preference(){return preference;},
    get resolved(){return document.documentElement.dataset.theme;},
    set(value){
      if(!valid(value))return;
      preference=value;
      try{global.localStorage.setItem(key,value);}catch{}
      apply();
    },
  };
  system.addEventListener('change',()=>{if(preference==='system')apply();});
  global.addEventListener('storage',event=>{
    if(event.key===key){preference=valid(event.newValue)?event.newValue:'system';apply();}
  });
  apply();
})(globalThis);
