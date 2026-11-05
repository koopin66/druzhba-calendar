/* Browser-only demonstration. Never uploads bookings or pretends to provide shared storage. */
(function (global) {
  'use strict';
  function createDemo({storage, key = 'druzhba-demo-v1', now = () => new Date(), crypto = global.crypto}) {
    const copy = value => JSON.parse(JSON.stringify(value));
    const stamp = () => now().toISOString();
    const id = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), b => b.toString(16).padStart(2,'0')).join('');
    const user = {id:1,name:'Тестовый календарь',login:'demo',role:'admin'};
    function write(data) {
      try { storage.setItem(key, JSON.stringify(data)); }
      catch { throw new Error('Не удалось сохранить на устройстве. Проверьте свободное место и разрешение браузера на хранение данных.'); }
    }
    function seed() {
      const date = new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).format(now());
      const prefix = date.slice(0,7);
      const samples = [
        [2,13,'Обед туристической группы','group',1,32],
        [3,18,'Семейный юбилей','banquet',2,24],
        [5,14,'Группа «Северный маршрут»','group',1,46],
        [5,18,'День рождения','banquet',2,28],
        [7,18,'Свадебный ужин','banquet',1,54],
        [9,13,'Группа из Петербурга','group',1,34],
        [11,9,'Деловой завтрак','meeting',2,22],
        [12,13,'Обед экскурсионной группы','group',1,38],
        [14,18,'Юбилей компании','banquet',1,48],
        [16,13,'Группа «Балтика»','group',1,29],
        [18,18,'Встреча выпускников','banquet',2,42],
        [20,18,'Семейный праздник','banquet',2,26],
        [21,14,'Группа из Москвы','group',1,35],
        [23,18,'Ужин делегации','meeting',2,24],
        [25,18,'День рождения','banquet',2,32],
        [27,13,'Обед туристической группы','group',1,40],
        [28,18,'Свадебный банкет','banquet',1,58],
      ];
      const events = samples.map(([day,hour,title,kind,room_id,guests], i) => ({
        id:id(),title,kind,room_id,guests,exclusive:Number(kind==='banquet'),
        start:`${prefix}-${String(day).padStart(2,'0')}T${String(hour).padStart(2,'0')}:00`,
        end:`${prefix}-${String(day).padStart(2,'0')}T${String(hour+(kind==='banquet'?4:2)).padStart(2,'0')}:00`,
        status:i%5===0?'request':'confirmed',contact:'Демонстрационный контакт',phone:'',
        notes:'Вымышленная заявка для знакомства с приложением.',version:1,updated_by:1,updated_at:stamp(),
      }));
      const year=Number(date.slice(0,4))+1;
      events.push({...events[2],id:id(),title:'Новогодняя туристическая группа',start:`${year}-01-05T14:00`,end:`${year}-01-05T16:00`,status:'confirmed'});
      return {schema:1,rooms:[{id:1,name:'Зал 1',capacity:72,version:1},{id:2,name:'Зал 2',capacity:55,version:1}],events,audit:[]};
    }
    function load() {
      let value;
      try { value=storage.getItem(key); }
      catch { throw new Error('Браузер запретил хранение данных. Разрешите его для тестового календаря.'); }
      if (value===null) {const data=seed();write(data);return data;}
      try {
        const data=JSON.parse(value);
        if(data.schema!==1||!Array.isArray(data.rooms)||!Array.isArray(data.events)||!Array.isArray(data.audit))throw new Error();
        return data;
      } catch {throw new Error('Не удалось прочитать тестовые данные в браузере. Откройте календарь в другом профиле браузера.');}
    }
    function validate(input) {
      const data=copy(input);
      for(const [field,max] of [['title',120],['contact',120],['phone',40],['notes',4000]]) {
        if(typeof data[field]!=='string'||data[field].length>max)throw new Error('Проверьте текстовые поля заявки.');
        data[field]=data[field].trim();
      }
      if(!data.title)throw new Error('Укажите название мероприятия.');
      if(!['group','banquet','meeting'].includes(data.kind)||!['request','confirmed','cancelled'].includes(data.status))throw new Error('Выберите тип и статус.');
      for(const field of ['start','end']) {
        const value=data[field];
        if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))throw new Error('Проверьте дату и время.');
        const parsed=new Date(value+'Z');
        if(Number.isNaN(parsed.getTime())||parsed.toISOString().slice(0,16)!==value)throw new Error('Проверьте дату и время.');
      }
      const duration=new Date(data.end+'Z')-new Date(data.start+'Z');
      if(duration<=0||duration>48*3600000)throw new Error('Окончание должно быть позже начала. Максимальная длительность — 48 часов.');
      if(!Number.isInteger(data.guests)||data.guests<1||data.guests>100000||!Number.isInteger(data.room_id)||data.room_id<1)throw new Error('Укажите зал и целое число гостей.');
      if(typeof data.exclusive!=='boolean')throw new Error('Проверьте режим бронирования зала.');
      return data;
    }
    function available(store, item, exclude='') {
      const room=store.rooms.find(r=>r.id===item.room_id);
      if(!room)throw new Error('Зал не найден.');
      const overlaps=store.events.filter(e=>e.room_id===item.room_id&&e.status!=='cancelled'&&e.id!==exclude&&e.start<item.end&&e.end>item.start);
      const points=overlaps.flatMap(e=>[[e.start>item.start?e.start:item.start,e.guests],[e.end<item.end?e.end:item.end,-e.guests]]);
      points.sort((a,b)=>a[0].localeCompare(b[0])||a[1]-b[1]);
      let current=0,peak=0;
      for(const [,amount] of points){current+=amount;peak=Math.max(peak,current);}
      const blocked=Boolean(overlaps.length&&(item.exclusive||overlaps.some(e=>e.exclusive)));
      const remaining=blocked?0:Math.max(0,room.capacity-peak);
      const allowed=!blocked&&item.guests<=remaining;
      return {available:allowed,remaining,capacity:room.capacity,overlaps:copy(overlaps),
        message:blocked?'Зал уже занят в это время. Выберите другой зал или время.':allowed?
          `Можно принять. После бронирования: ${remaining-item.guests} свободных мест.`:
          `Недостаточно мест. Свободно: ${remaining} из ${room.capacity}.`};
    }
    function audit(data,action,details) {
      data.audit.unshift({at:stamp(),action,details,name:'Тестовый календарь'});
      data.audit=data.audit.slice(0,100);
    }
    function perform(path,options={}) {
      if(path==='health')return {ok:true,demo:true,local:true};
      if(['demo','login','logout'].includes(path))return {ok:true};
      if(path==='password')throw new Error('В тестовой версии вход без пароля. Общий доступ будет подключён на сервере.');
      const data=load(), item=options.body, method=options.method||'GET';
      if(path==='state')return {...copy(data),events:copy(data.events).sort((a,b)=>a.start.localeCompare(b.start)),user:copy(user),demo:true,local:true,timezone:'Europe/Moscow'};
      if(path==='users')return [copy(user)];
      if(path==='audit')return copy(data.audit);
      if(path==='backup')return copy(data);
      if(path==='reset'&&method==='POST'){const fresh=seed();write(fresh);return {ok:true};}
      if(path==='availability')return available(data,validate(item),item.id||'');
      if(path==='events'&&method==='POST'||/^events\/[a-f0-9]{24}$/.test(path)&&method==='PUT') {
        const valid=validate(item), eventId=method==='PUT'?path.split('/')[1]:id();
        const old=data.events.find(e=>e.id===eventId);
        if(method==='PUT'&&!old)throw new Error('Заявка не найдена.');
        if(old&&old.version!==item.version)throw new Error('Заявка уже изменена в другой вкладке. Закройте карточку и откройте заново.');
        const check=available(data,valid,eventId);
        if(valid.status!=='cancelled'&&!check.available)throw new Error(check.message);
        const event={...valid,id:eventId,exclusive:Number(valid.exclusive),version:old?old.version+1:1,updated_by:1,updated_at:stamp()};
        if(old)data.events[data.events.indexOf(old)]=event;else data.events.push(event);
        audit(data,old?'Изменена заявка':'Создана заявка',event.title);
        write(data);return copy(event);
      }
      if(path==='rooms'&&method==='POST') {
        const {name,capacity}=item;
        if(typeof name!=='string'||!name.trim()||name.length>80||!Number.isInteger(capacity)||capacity<1||capacity>100000)throw new Error('Укажите название и вместимость зала.');
        const old=data.rooms.find(r=>r.id===item.id);
        if(item.id&&(!old||old.version!==item.version))throw new Error('Настройки зала изменены. Обновите страницу.');
        if(old) {
          const marks=data.events.filter(e=>e.room_id===old.id&&e.status!=='cancelled').flatMap(e=>[[e.start,e.guests],[e.end,-e.guests]]);
          marks.sort((a,b)=>a[0].localeCompare(b[0])||a[1]-b[1]);let current=0;
          for(const [,amount] of marks){current+=amount;if(current>capacity)throw new Error('В существующих заявках уже больше гостей. Сначала измените заявки.');}
          old.name=name.trim();old.capacity=capacity;old.version++;
        }else data.rooms.push({id:Math.max(0,...data.rooms.map(r=>r.id))+1,name:name.trim(),capacity,version:1});
        audit(data,'Обновлён зал',name);write(data);return {ok:true};
      }
      throw new Error('Это действие недоступно в тестовой версии.');
    }
    return {key,request(path,options) {
      const run=()=>perform(path,options);
      // The browser lock prevents two tabs overwriting each other's local booking changes.
      if(global.document&&global.navigator?.locks)return global.navigator.locks.request(key,run);
      return Promise.resolve().then(run);
    }};
  }
  if(typeof module!=='undefined'&&module.exports)module.exports={createDemo};
  else global.DruzhbaDemo=createDemo({storage:global.localStorage,key:'druzhba-demo-v1:'+new URL('./',global.location.href).pathname});
})(globalThis);
