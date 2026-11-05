'use strict';
const LOCAL_DEMO = Boolean(globalThis.DruzhbaDemo);
const ACCESS_LABEL = LOCAL_DEMO ? 'Демоверсия' : 'Общий доступ';
document.body.classList.toggle('local-demo',LOCAL_DEMO);
const $ = (selector, root = document) => root.querySelector(selector);
const root = $('#root'), dialog = $('#dialog');
const glyphs = {
  calendar: '<rect x="40" y="48" width="176" height="176" rx="8"/><path d="M176 32v32M80 32v32M40 96h176M80 136h16m32 0h16m32 0h0M80 176h16m32 0h16"/>',
  list: '<rect x="48" y="40" width="160" height="184" rx="8"/><path d="M88 88h80M88 128h80M88 168h48"/>',
  users: '<circle cx="88" cy="96" r="32"/><path d="M24 200c0-36 28-64 64-64s64 28 64 64M168 64a32 32 0 0 1 0 64m16 16c28 8 48 28 48 56"/>',
  settings: '<path d="m104 32-8 24-24 16-24-4-24 40 16 20v24l-16 20 24 40 24-4 24 16 8 24h48l8-24 24-16 24 4 24-40-16-20v-24l16-20-24-40-24 4-24-16-8-24z"/><circle cx="128" cy="140" r="36"/>',
  clock: '<circle cx="128" cy="128" r="96"/><path d="M128 72v56l40 24"/>',
  plus: '<path d="M128 48v160M48 128h160"/>',
  chevron: '<path d="m104 64 64 64-64 64"/>',
  left: '<path d="m152 64-64 64 64 64"/>',
  down: '<path d="m64 104 64 64 64-64"/>',
  search: '<circle cx="112" cy="112" r="72"/><path d="m164 164 52 52"/>',
  bell: '<path d="M48 184h160l-16-24v-48a64 64 0 0 0-128 0v48zm56 32h48"/>',
  phone: '<rect x="72" y="24" width="112" height="208" rx="16"/><path d="M112 200h32"/>',
  logout: '<path d="M112 32H48v192h64M112 128h112m-40-40 40 40-40 40"/>',
  check: '<path d="m48 128 48 48L208 64"/>',
  close: '<path d="m64 64 128 128M192 64 64 192"/>',
  info: '<circle cx="128" cy="128" r="96"/><path d="M128 112v64m0-100h0"/>',
  download: '<path d="M128 32v128m-48-48 48 48 48-48M40 176v40h176v-40"/>',
  banquet: '<path d="M32 184h192M48 168a80 80 0 0 1 160 0M128 88V64m-16-8h32M48 208h160"/>',
  building: '<path d="M40 224V80h80V32h96v192M24 224h208M72 112h16m-16 40h16m-16 40h16M152 64h24m-24 40h24m-24 40h24m-24 40h24"/>',
  arrow: '<path d="M40 128h176m-64-64 64 64-64 64"/>',
  shield: '<path d="M128 24 40 56v64c0 64 88 112 88 112s88-48 88-112V56zM88 128l24 24 56-56"/>',
  edit: '<path d="m152 48 56 56M40 216l8-64L176 24l56 56L104 208z"/>',
  help: '<circle cx="128" cy="128" r="96"/><path d="M96 96a32 32 0 1 1 48 28c-12 8-16 12-16 28m0 32h0"/>',
  moon: '<path d="M216 144A88 88 0 0 1 112 40a88 88 0 1 0 104 104Z"/>',
  sun: '<circle cx="128" cy="128" r="48"/><path d="M128 24v16m0 176v16M24 128h16m176 0h16M54 54l12 12m124 124 12 12M54 202l12-12M190 66l12-12"/>',
};
const icon = name => `<svg class="icon" viewBox="0 0 256 256" aria-hidden="true">${glyphs[name] || glyphs.calendar}</svg>`;
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const dateKey = date => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
const parseDay = text => new Date(`${text}T12:00:00`);
const todayKey = () => new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const formatDay = (day, options={day:'numeric',month:'long'}) => parseDay(day).toLocaleDateString('ru-RU',options);
const timeOf = text => text.slice(11,16);
const statusNames = {confirmed:'Подтверждено',request:'Заявка',cancelled:'Отменено'};
const kindNames = {group:'Группа',banquet:'Банкет',meeting:'Мероприятие'};
const plural = (n, one, few, many) => n%100>=11 && n%100<=14 ? many : n%10===1 ? one : n%10>=2 && n%10<=4 ? few : many;
const eventCount = n => `${n} ${plural(n,'событие','события','событий')}`;
const guestCount = n => `${n} ${plural(n,'гость','гостя','гостей')}`;
const seatCount = n => `${n} ${plural(n,'место','места','мест')}`;
let state = null, selected = todayKey(), month = parseDay(selected), view = 'month', page = 'calendar';
let roomFilter = '', statusFilter = '', search = '', listFrom = '', listTo = '';
let connected = true, lastSync = '', installPrompt = null, refreshRunning = false, previousState = '';
let checkTimer, checkSequence = 0, toastTimer;
const roomName = id => state.rooms.find(r => r.id === id)?.name || 'Зал';

async function api(path, options = {}) {
  if(LOCAL_DEMO){connected=true;return globalThis.DruzhbaDemo.request(path,options);}
  let response;
  try {
    response = await fetch(`/api/${path}`, {credentials:'same-origin',cache:'no-store',...options,
      headers:{'Content-Type':'application/json','X-Druzhba-Request':'1',...options.headers},
      body: options.body ? JSON.stringify(options.body) : undefined});
  } catch {
    connected = false;
    updateSync();
    throw new Error('Нет связи с сервером. Проверьте интернет. Заявка ещё не сохранена.');
  }
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401 && state && !['login','password'].includes(path)) {
      state = null;
      if (dialog.open) dialog.close();
      renderLogin('Сессия завершена. Войдите снова.');
    }
    throw new Error(data.error || 'Не удалось выполнить действие. Попробуйте снова.');
  }
  connected = true;
  return data;
}

function toast(message) {
  clearTimeout(toastTimer);
  $('#toast').textContent = message;
  $('#toast').classList.add('visible');
  toastTimer = setTimeout(() => $('#toast').classList.remove('visible'),4000);
}

function updateSync() {
  const node = $('#sync');
  if (node) {
    node.classList.toggle('offline',!connected);
    node.innerHTML = `<span class="dot"></span>${LOCAL_DEMO?'На этом устройстве':connected ? 'Общий календарь' : 'Нет связи с сервером'}`;
    node.title = LOCAL_DEMO?'Тестовые данные сохраняются в этом браузере. Между устройствами синхронизации нет.':connected ? `Обновлено в ${lastSync}. Проверка изменений каждые 15 секунд.` : 'Доступность мест нужно проверить после восстановления связи.';
  }
  document.querySelectorAll('[data-action="new"],[data-action="check"]').forEach(b => b.disabled = !connected);
}

async function refresh(force = false) {
  if (refreshRunning) return;
  refreshRunning = true;
  try {
    const next = await api('state');
    state = next;
    lastSync = new Date().toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit',timeZone:'Europe/Moscow'});
    const serialized = JSON.stringify(next);
    if (force || serialized !== previousState) {
      previousState = serialized;
      render();
    }
    updateSync();
  } catch (error) {
    updateSync();
    if (!state) await renderLogin(error.message);
  } finally { refreshRunning = false; }
}

async function renderLogin(error = '') {
  let demo = false;
  try { demo = (await api('health')).demo; } catch { /* Login remains usable after reconnect. */ }
  root.innerHTML = `<main class="login-layout" id="main">
    <section class="login-story"><div class="brand"><img class="brand-mark" src="./icon-v2.svg" alt=""><div><strong>Дружба</strong><small>ресторан · Выборг</small></div></div>
      <div><div class="eyebrow">Всё на своих местах</div><h1>Больше внимания гостям.<br>Меньше забот о планах.</h1><p>Группы, банкеты и свободные места в одном календаре. Рядом с рестораном или в другом городе.</p>
      <div class="login-illustration" aria-hidden="true">${Array.from({length:21},(_,i)=>`<span class="${[4,8,9,15].includes(i)?'lit':''}">${i+1}</span>`).join('')}</div></div>
      <div class="small">Календарь ресторана при гостинице «Дружба»</div></section>
    <section class="login-box"><div class="login-form"><div class="eyebrow">Добро пожаловать</div><h2>Войти в календарь</h2><p>Все планы команды в одном месте.</p>
    <form id="login-form"><label class="field">Логин<input name="login" autocomplete="username" required maxlength="80" placeholder="Ваш логин" autocapitalize="none"></label>
    <label class="field">Пароль<input name="password" type="password" autocomplete="current-password" required maxlength="200" placeholder="Ваш пароль"></label>
    <div class="form-error" id="login-error" role="alert">${escape(error)}</div><button class="button primary" type="submit">Войти ${icon('arrow')}</button></form>
    ${demo?'<button class="button secondary demo-login" data-action="demo">Посмотреть демоверсию</button>':''}
    <div class="login-note">${demo?'Демоверсия с вымышленными заявками.':'Первый вход: логин и пароль выдаёт администратор. Начальный пароль администратора указан в окне сервера.'}<br>Время мероприятий всегда московское.</div></div></section></main>`;
  $('#login-form').addEventListener('submit',async event => {
    event.preventDefault();
    const button = $('button',event.target);
    button.disabled = true; button.textContent = 'Входим…';
    try {
      await api('login',{method:'POST',body:Object.fromEntries(new FormData(event.target))});
      await refresh(true);
      const params = new URLSearchParams(location.search);
      if (params.has('new')) openEvent();
    } catch (e) { $('#login-error').textContent = e.message; }
    finally { button.disabled = false; button.textContent = 'Войти'; }
  });
}

function visibleEvents(includeCancelled = false) {
  const needle = search.trim().toLocaleLowerCase('ru-RU');
  return state.events.filter(e => (includeCancelled || e.status !== 'cancelled' || statusFilter === 'cancelled') &&
    (!roomFilter || e.room_id === Number(roomFilter)) && (!statusFilter || e.status === statusFilter) &&
    (!needle || [e.title,e.contact,e.phone,e.notes].join(' ').toLocaleLowerCase('ru-RU').includes(needle)));
}
function dayEvents(day, events = visibleEvents()) {
  return events.filter(e => e.start < `${dateKey(new Date(parseDay(day).getTime()+86400000))}T00:00` && e.end > `${day}T00:00`);
}
const badge = status => `<span class="badge ${status}">${status==='confirmed'?icon('check'):''}${statusNames[status]}</span>`;
const action = (name,label,cls='button',symbol='') => `<button class="${cls}" data-action="${name}">${symbol?icon(symbol):''}${label}</button>`;
function themeButton() {
  const dark=globalThis.DruzhbaTheme?.resolved==='dark';
  const label=dark?'Включить светлую тему':'Включить тёмную тему';
  return `<button class="icon-button theme-toggle" data-action="theme" title="${label}" aria-label="${label}" aria-pressed="${dark}">${icon(dark?'sun':'moon')}</button>`;
}
function appearanceCard() {
  return `<section class="settings-card appearance-card"><h2>Оформление</h2><p>Выберите удобную тему. Автоматический режим следует настройкам вашего устройства.</p><div class="field"><label for="appearance-select">Тема приложения</label><select id="appearance-select"><option value="system">Как на устройстве</option><option value="light">Светлая</option><option value="dark">Тёмная</option></select></div></section>`;
}
function updateThemeControls() {
  const dark=globalThis.DruzhbaTheme?.resolved==='dark';
  document.querySelectorAll('[data-action="theme"]').forEach(button=>{
    const label=dark?'Включить светлую тему':'Включить тёмную тему';
    button.innerHTML=icon(dark?'sun':'moon');button.title=label;button.setAttribute('aria-label',label);button.setAttribute('aria-pressed',String(dark));
  });
  const selector=$('#appearance-select');
  if(selector)selector.value=globalThis.DruzhbaTheme?.preference||'system';
}

function render() {
  if (!state) return;
  const requestCount = state.events.filter(e=>e.status==='request').length;
  const nav = [ ['calendar','calendar','Календарь'],['bookings','list','Все заявки'],['settings','settings','Настройки'],['help','help','Помощь'] ];
  root.innerHTML = `<div class="shell"><aside class="sidebar" aria-label="Главное меню">
    <div class="brand"><img class="brand-mark" src="./icon-v2.svg" alt=""><div><strong>Дружба</strong><small>ресторан · Выборг</small></div></div>
    <div><p class="nav-label">РАБОЧЕЕ ПРОСТРАНСТВО</p><nav class="nav">${nav.map(([key,symbol,label])=>`<button data-page="${key}" class="${page===key?'active':''}" ${page===key?'aria-current="page"':''} aria-label="${label}">${icon(symbol)}<span>${label}</span>${key==='bookings'&&requestCount?`<span class="count">${requestCount}</span>`:''}</button>`).join('')}</nav></div>
    <div class="sidebar-bottom"><div class="install-card">${icon('phone')}<div><h3>Дружба всегда рядом</h3><p>Установите календарь на телефон или компьютер.</p></div><button data-action="install">Как установить <span aria-hidden="true">↗</span></button></div>
      <div class="user"><span class="avatar">${escape(state.user.name.slice(0,1))}</span><div class="user-info"><strong>${escape(state.user.name)}</strong><span>${ACCESS_LABEL}</span></div><button class="icon-button quiet" data-action="logout" title="Выйти" aria-label="Выйти">${icon('logout')}</button></div></div></aside>
    <div class="content"><header class="topbar"><div class="mobile-brand"><img class="brand-mark" src="./icon-v2.svg" alt="">Дружба</div><div class="breadcrumb"><span>Ресторан «Дружба»</span>${icon('chevron')}<strong>${nav.find(n=>n[0]===page)?.[2]}</strong></div><div class="top-actions">
      <span class="sync" id="sync"><span class="dot"></span>Общий календарь</span><label class="search">${icon('search')}<input id="global-search" type="search" placeholder="Найти заявку…" aria-label="Поиск заявок" value="${escape(search)}"></label>
      ${themeButton()}<button class="icon-button quiet" data-action="requests" title="Неподтверждённые заявки" aria-label="Неподтверждённые заявки">${icon('bell')}</button></div></header>
    <main id="main" class="main">${pageContent()}</main></div>
    <nav class="mobile-nav" aria-label="Навигация на телефоне">${nav.map(([key,symbol,label])=>`<button data-page="${key}" class="${page===key?'active':''}" ${page===key?'aria-current="page"':''}>${icon(symbol)}${key==='bookings'?'Заявки':label}</button>`).join('')}</nav></div>`;
  bindPage();
  updateSync();
}

function pageContent() {
  const titles = {calendar:['Календарь событий','Хороший день начинается с плана.'],bookings:['Все заявки','Ни одна договорённость не потеряется.'],settings:['Настройки','Залы, общий доступ и сохранность данных.'],help:['Всегда под рукой','Несколько подсказок для спокойной работы.']};
  const [title,subtitle] = titles[page];
  let body = `<div class="heading"><div><h1>${title}</h1><p>${subtitle}</p></div>${['calendar','bookings'].includes(page)?action('new','<span class="long-label">Новая заявка</span><span class="short-label">Добавить</span>','button primary','plus'):''}</div>`;
  if (state.demo) body += `<div class="demo-banner">${icon('info')}${LOCAL_DEMO?'Тестовая версия · данные сохраняются только на этом устройстве. Используйте вымышленные контакты.':'Демоверсия · заявки вымышлены · залы на 72 и 55 гостей.'}</div>`;
  if (page==='calendar') body += calendarContent();
  if (page==='bookings') body += bookingsContent();
  if (page==='settings') body += settingsContent();
  if (page==='help') body += helpContent();
  return body + `<footer class="page-footer"><span>Дружба · ресторан при гостинице · Выборг</span><span>Время московское · ${action('install','Установка','text-button')}</span></footer>`;
}

function calendarContent() {
  const monthEvents = state.events.filter(e=>e.status!=='cancelled' && e.start.slice(0,7) === dateKey(month).slice(0,7));
  const guestTotal = monthEvents.reduce((sum,e)=>sum+e.guests,0);
  const pending = monthEvents.filter(e=>e.status==='request').length;
  return `<section class="summary" aria-label="За выбранный месяц"><div class="summary-item"><span class="summary-icon">${icon('calendar')}</span><div><p>Событий в этом месяце</p><strong>${monthEvents.length}</strong><small>в календаре</small></div></div><div class="summary-item"><span class="summary-icon">${icon('users')}</span><div><p>Гостей ожидаем</p><strong>${guestTotal.toLocaleString('ru-RU')}</strong><small>по всем заявкам</small></div></div><div class="summary-item"><span class="summary-icon">${icon('clock')}</span><div><p>Ждут подтверждения</p><strong>${pending}</strong><small>заявок</small></div></div></section>
    <div class="workspace"><section class="calendar" aria-label="Календарь мероприятий"><div class="calendar-toolbar"><div class="month-title"><h2>${month.toLocaleDateString('ru-RU',{month:'long',year:'numeric'}).replace(' г.','')}</h2><input class="month-picker" id="month-picker" type="month" value="${dateKey(month).slice(0,7)}" aria-label="Перейти к месяцу" title="Выбрать месяц"></div><div class="calendar-controls"><button class="icon-button" data-action="prev" aria-label="Предыдущий период">${icon('left')}</button><button class="today-btn" data-action="today">Сегодня</button><button class="icon-button" data-action="next" aria-label="Следующий период">${icon('chevron')}</button></div><div class="segmented" aria-label="Вид календаря">${[['month','Месяц'],['week','Неделя'],['day','День']].map(([key,label])=>`<button data-view="${key}" class="${key===view?'active':''}" aria-pressed="${key===view}">${label}</button>`).join('')}</div></div>
    <div class="filters">${roomTabs()}${statusSelect()}</div>
    ${view==='month'?monthGrid():view==='week'?weekGrid():dayTimeline()}
    <div class="calendar-footer"><span class="legend"><span class="dot"></span>Группа</span><span class="legend banquet"><span class="dot"></span>Банкет</span><span class="legend request"><span class="dot"></span>Заявка</span><span class="timezone">Москва, UTC+3</span></div></section>
    <aside class="day-panel" aria-label="Выбранный день">${agenda()}<section class="insight">${icon('calendar')}<h3>Есть место для новых планов</h3><p>Укажите время и число гостей. Календарь проверит свободные места во всех залах.</p><button data-action="check">Проверить дату ${icon('arrow')}</button></section></aside></div>`;
}
function roomTabs() {
  return `<div class="room-tabs" aria-label="Фильтр по залам"><button class="room-tab ${!roomFilter?'active':''}" data-room="">Все залы</button>${state.rooms.map(r=>`<button class="room-tab ${Number(roomFilter)===r.id?'active':''}" data-room="${r.id}">${escape(r.name)}</button>`).join('')}</div>`;
}
function statusSelect() {
  return `<select class="status-filter" id="status-filter" aria-label="Фильтр по статусу"><option value="">Все статусы</option>${Object.entries(statusNames).map(([key,label])=>`<option value="${key}" ${key===statusFilter?'selected':''}>${label}</option>`).join('')}</select>`;
}
function eventChip(event) {
  return `<button class="event-chip ${event.kind} ${event.status}" data-event="${event.id}" title="${escape(event.title)} · ${timeOf(event.start)} — ${timeOf(event.end)} · ${guestCount(event.guests)} · ${escape(roomName(event.room_id))}"><span class="chip-time">${timeOf(event.start)}${view==='month'?'':` — ${timeOf(event.end)}`}</span> <span class="chip-title">${escape(event.title)}</span><span class="chip-meta">${guestCount(event.guests)} · ${escape(roomName(event.room_id))}</span></button>`;
}
function monthGrid() {
  const start = new Date(month.getFullYear(),month.getMonth(),1,12);
  start.setDate(start.getDate()-(start.getDay()+6)%7);
  const last = new Date(month.getFullYear(),month.getMonth()+1,0);
  const count = Math.ceil(((new Date(month.getFullYear(),month.getMonth(),1).getDay()+6)%7 + last.getDate())/7)*7;
  let cells = '';
  for (let i=0;i<count;i++) {
    const date = new Date(start);date.setDate(start.getDate()+i);
    const day = dateKey(date), items = dayEvents(day);
    const classes = [date.getMonth()!==month.getMonth()?'outside':'',day===selected?'selected':'',i%7>=5?'weekend':''].join(' ');
    cells += `<div class="day-cell ${classes}" data-day="${day}" role="button" tabindex="0" aria-label="${formatDay(day)}: ${eventCount(items.length)}" aria-pressed="${day===selected}"><div class="day-top"><span class="day-number ${day===todayKey()?'today':''}">${date.getDate()}</span><button class="day-add" data-new-day="${day}" aria-label="Добавить заявку на ${formatDay(day)}">+</button></div>${items.slice(0,2).map(eventChip).join('')}${items.length>2?`<span class="more-events">ещё ${items.length-2}</span>`:''}</div>`;
  }
  return `<div class="weekdays" aria-hidden="true">${['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].map(d=>`<span>${d}</span>`).join('')}</div><div class="month-grid">${cells}</div>`;
}
function weekGrid() {
  const start = parseDay(selected); start.setDate(start.getDate()-(start.getDay()+6)%7);
  return `<div class="week-grid">${Array.from({length:7},(_,i)=>{
    const d=new Date(start);d.setDate(start.getDate()+i);const key=dateKey(d);
    return `<div class="week-column ${key===selected?'selected':''}"><button class="week-head" data-day="${key}">${d.toLocaleDateString('ru-RU',{weekday:'short'})}<strong>${d.getDate()}</strong></button>${dayEvents(key).map(eventChip).join('')}${action('new','+','day-add')}</div>`;
  }).join('')}</div>`;
}
function dayTimeline() {
  const events = dayEvents(selected), used = new Set();
  return `<div class="timeline"><p class="muted small">${formatDay(selected,{weekday:'long',day:'numeric',month:'long'})}</p>${Array.from({length:24},(_,i)=>{
    const matches=events.filter(e=>Math.max(0,e.start.slice(0,10)<selected?0:Number(e.start.slice(11,13)))===i && !used.has(e.id));
    matches.forEach(e=>used.add(e.id));
    return `<div class="timeline-row"><span class="timeline-hour">${String(i).padStart(2,'0')}:00</span><div class="timeline-content">${matches.map(eventChip).join('') || `<button class="timeline-free" data-hour="${i}">+ Добавить</button>`}</div></div>`;
  }).join('')}</div>`;
}
function agenda() {
  const events = dayEvents(selected), active=events.filter(e=>e.status!=='cancelled');
  return `<section class="agenda"><div class="agenda-title"><div><p class="eyebrow">${selected===todayKey()?'Сегодня':'Выбранный день'}</p><h2>${formatDay(selected)}</h2></div><button class="icon-button quiet" data-action="day-view" aria-label="Открыть расписание дня">${icon('calendar')}</button></div><p class="day-caption">${formatDay(selected,{weekday:'long'})} · <strong>${eventCount(active.length)}</strong></p><div class="day-summary">${icon('users')}${guestCount(active.reduce((s,e)=>s+e.guests,0))} за день · все заявки</div>
    <div class="agenda-events">${events.length?events.map(e=>`<article class="agenda-event"><div class="event-time"><span>${timeOf(e.start)} — ${timeOf(e.end)}${e.end.slice(0,10)!==e.start.slice(0,10)?' +1 день':''}</span>${badge(e.status)}</div><button class="agenda-link" data-event="${e.id}">${escape(e.title)}</button><div class="event-detail">${icon('users')}${guestCount(e.guests)} <span>·</span>${kindNames[e.kind]}</div><div class="event-detail">${icon('building')}${escape(roomName(e.room_id))}${e.exclusive?' · целиком':''}</div></article>`).join(''):`<div class="empty">${icon('calendar')}<h3>Новые планы впереди</h3><p>На этот день пока нет заявок.<br>Добавьте первую или проверьте места.</p></div>`}</div>${action('new','Добавить событие','button secondary full','plus')}</section>`;
}
function bookingsContent() {
  const events=visibleEvents(true).filter(e=>(!listFrom||e.end>=`${listFrom}T00:00`)&&(!listTo||e.start<=`${listTo}T23:59`));
  return `<div class="list-toolbar"><label class="field">С даты<input class="control" id="list-from" type="date" value="${listFrom}"></label><label class="field">По дату<input class="control" id="list-to" type="date" value="${listTo}"></label><label class="field">Поиск<input class="control" id="list-search" type="search" placeholder="Название, контакт…" value="${escape(search)}"></label>${statusSelect()}${action('export','Выгрузить CSV','button','download')}</div><div class="list-toolbar">${roomTabs()}<span class="muted small">Найдено: ${events.length}</span></div>
    <div class="table-wrap"><table><thead><tr><th>Дата и время</th><th>Мероприятие</th><th>Зал</th><th>Гостей</th><th>Статус</th><th>Контакт</th></tr></thead><tbody>${events.map(e=>`<tr><td>${formatDay(e.start.slice(0,10),{day:'numeric',month:'short',year:'numeric'})}<br><span class="muted">${timeOf(e.start)} — ${timeOf(e.end)}</span></td><td><button class="table-link" data-event="${e.id}"><strong>${escape(e.title)}</strong><br><span class="muted">${kindNames[e.kind]}</span></button></td><td>${escape(roomName(e.room_id))}</td><td>${e.guests}</td><td>${badge(e.status)}</td><td>${escape(e.contact)||'Не указан'}<br><span class="muted">${escape(e.phone)}</span></td></tr>`).join('')}</tbody></table>${!events.length?'<div class="no-results">Заявок по выбранным условиям нет. Измените фильтры или добавьте новую заявку.</div>':''}</div>`;
}
function settingsContent() {
  if(LOCAL_DEMO)return demoSettingsContent();
  return `<div class="settings-grid">${appearanceCard()}<section class="settings-card"><h2>Залы ресторана</h2><p>Вместимость ограничивает число гостей, которые могут находиться в зале одновременно.</p>${state.rooms.map(r=>`<div class="room-row"><strong>${escape(r.name)}</strong><span class="muted">${seatCount(r.capacity)}</span>${state.user.role==='admin'?`<button class="icon-button quiet" data-edit-room="${r.id}" aria-label="Изменить ${escape(r.name)}">${icon('edit')}</button>`:''}</div>`).join('')}${state.user.role==='admin'?action('add-room','Добавить зал','button secondary','plus'):''}</section>
    <section class="settings-card"><h2>Общий доступ команды</h2><p>Одна учётная запись для компьютера и телефонов.<br>Общий логин: ${escape(state.user.login)}</p><div class="help-list"><p>После смены общего пароля на всех устройствах потребуется войти заново. Передайте новый пароль коллегам, которые работают с календарём.</p></div>${action('password','Изменить пароль','button','shield')} ${action('logout','Выйти','button','logout')}</section>
    ${state.user.role==='admin'?`<section class="settings-card"><h2>Сохранность данных</h2><p>Заявки сохраняются на сервере. Скачивайте резервную копию перед обновлением приложения и храните её в защищённом месте.</p><a class="button" href="/api/backup" download="druzhba-backup.sqlite3">${icon('download')}Скачать резервную копию</a><p>Копия содержит контакты, хеши паролей и сессии доступа. Передавайте её только ответственному за приложение.</p></section><section class="settings-card"><h2>Последние изменения</h2><p>История общих действий в календаре. При одном логине все изменения отображаются от имени команды ресторана.</p><div id="audit-list" class="muted small">Загружаем историю…</div></section>`:''}</div>`;
}
function helpContent() {
  if(LOCAL_DEMO)return `<div class="settings-grid"><section class="settings-card help-list"><h2>Попробуйте календарь</h2><ol><li>Выберите день и нажмите «Новая заявка».</li><li>Задайте время начала и окончания, зал и число гостей.</li><li>Проверьте доступность и сохраните заявку.</li><li>Откройте её снова, измените или отмените.</li></ol><p>Зал 1 вмещает 72 гостя, зал 2 — 55. Календарь открывается пустым — добавьте первую заявку на удобную дату.</p><h3>Проверка мест</h3><p>Предварительные и подтверждённые заявки занимают места. Отменённые освобождают их. Опция «Зал целиком» исключает другие мероприятия в этом зале на пересекающееся время.</p><h3>Время ресторана</h3><p>Вводите московское время ресторана в Выборге, даже находясь в другом часовом поясе.</p></section><section class="settings-card help-list"><h2>Как устроена тестовая версия</h2><p>Это демонстрация интерфейса. Вы можете добавлять свои тестовые события и перезагружать страницу: записи сохраняются в браузере этого устройства.</p><p>На другом телефоне, компьютере или в другом браузере будет отдельный календарь. Общую базу и вход команды подключим после размещения серверной версии.</p><p>Очистка данных браузера удаляет тестовые записи. В настройках можно скачать JSON-копию или очистить календарь.</p>${action('install','Установить приложение','button primary','phone')}</section></div>`;
  return `<div class="settings-grid"><section class="settings-card help-list"><h2>Принять новую заявку</h2><ol><li>Выберите дату в календаре.</li><li>Нажмите «Новая заявка».</li><li>Укажите время начала и окончания, зал и число гостей.</li><li>Проверьте результат доступности и сохраните.</li></ol><p>Например: 5 января, 14:00, туристическая группа. Если зал занят, выберите другой или предложите другое время.</p><h3>Что занимает места</h3><p>Заявки и подтверждённые мероприятия резервируют места. Отменённые заявки остаются в истории и освобождают зал.</p><h3>Банкет в закрытом зале</h3><p>Включите «Зал целиком», чтобы другие группы нельзя было забронировать на пересекающееся время. Без этой опции группы могут делить зал в пределах вместимости.</p></section>
    <section class="settings-card help-list"><h2>Работа с телефона и из другого города</h2><p>Откройте адрес общего сервера и войдите под общим логином. У всех сотрудников один календарь. Изменения появляются в течение 15 секунд, при сохранении доступность проверяется сразу.</p><p>При отсутствии связи новые брони не сохраняются. Это помогает избежать двойного бронирования по устаревшему календарю.</p>${action('install','Установить приложение','button primary','phone')}<h3>Часовой пояс</h3><p>Все даты и время относятся к ресторану в Выборге: Москва, UTC+3. При поездках в другой часовой пояс вводите время ресторана.</p><h3>Изменение и отмена</h3><p>Нажмите на мероприятие, отредактируйте поля и сохраните. Для отмены нажмите «Отменить заявку» и подтвердите действие. Отменённые заявки доступны в разделе «Все заявки».</p></section></div>`;
}

function demoSettingsContent() {
  return `<div class="settings-grid">${appearanceCard()}<section class="settings-card"><h2>Залы ресторана</h2><p>Попробуйте настройки вместимости. Изменения относятся только к вашему тестовому календарю.</p>${state.rooms.map(r=>`<div class="room-row"><strong>${escape(r.name)}</strong><span class="muted">${seatCount(r.capacity)}</span><button class="icon-button quiet" data-edit-room="${r.id}" aria-label="Изменить ${escape(r.name)}">${icon('edit')}</button></div>`).join('')}${action('add-room','Добавить зал','button secondary','plus')}</section><section class="settings-card help-list"><h2>Тест на этом устройстве</h2><p>Тестовые заявки сохраняются в этом браузере. Синхронизация с другими телефонами и компьютерами появится после подключения общего сервера.</p><p>Вход в демоверсию свободный. Используйте вымышленные имена и контакты.</p>${action('demo-backup','Скачать тестовые данные','button','download')}${action('demo-reset','Очистить календарь','button secondary')}</section><section class="settings-card"><h2>Последние изменения</h2><p>История действий в этом тестовом календаре.</p><div id="audit-list" class="muted small">Загружаем историю…</div></section><section class="settings-card"><h2>Приложение на телефоне</h2><p>Откройте ссылку в Safari на iPhone или Chrome на Android и добавьте приложение на главный экран. На ПК используйте Chrome или Edge.</p>${action('install','Как установить','button primary','phone')}</section></div>`;
}

function bindPage() {
  updateThemeControls();
  $('#appearance-select')?.addEventListener('change',event=>globalThis.DruzhbaTheme?.set(event.target.value));
  const bindSearch = id => $(id)?.addEventListener('input',event=>{
    const cursor=event.target.selectionStart;search=event.target.value;render();
    const input=$(id);input?.focus();input?.setSelectionRange(cursor,cursor);
  });
  bindSearch('#global-search');bindSearch('#list-search');
  $('#status-filter')?.addEventListener('change',e=>{statusFilter=e.target.value;render();});
  $('#month-picker')?.addEventListener('change',e=>{if(e.target.value){month=parseDay(`${e.target.value}-01`);selected=dateKey(month);render();}});
  $('#list-from')?.addEventListener('change',e=>{listFrom=e.target.value;render();});
  $('#list-to')?.addEventListener('change',e=>{listTo=e.target.value;render();});
  if (page==='settings'&&state.user.role==='admin') loadSettings();
}
async function loadSettings() {
  const results=await Promise.allSettled([api('users'),api('audit')]);
  if (page!=='settings') return;
  const users=$('#users-list'),audit=$('#audit-list');
  if(users) users.innerHTML=results[0].status==='fulfilled'?results[0].value.map(u=>`<div class="account-row"><div><strong>${escape(u.name)}</strong><small>${escape(u.login)}</small></div><span>${u.role==='admin'?'Администратор':'Менеджер'}</span></div>`).join(''):'Не удалось загрузить сотрудников. Обновите страницу.';
  if(audit) audit.innerHTML=results[1].status==='fulfilled'?results[1].value.slice(0,12).map(a=>`<div class="audit-row"><strong>${escape(a.action)}</strong> · ${escape(a.details)}<p>${escape(a.name)} · ${formatDay(a.at.slice(0,10))}, ${timeOf(a.at)}</p></div>`).join('')||'Изменений пока нет.':'Не удалось загрузить историю. Обновите страницу.';
}

function openDialog(title,subtitle,body,footer='',form=false) {
  checkSequence++;
  clearTimeout(checkTimer);
  dialog.innerHTML=`${form?'<form id="modal-form">':''}<div class="dialog-header"><div><h2 id="dialog-title">${title}</h2>${subtitle?`<p>${subtitle}</p>`:''}</div><button class="icon-button quiet" type="button" data-action="close" aria-label="Закрыть">${icon('close')}</button></div><div class="dialog-body">${body}<div class="form-error" id="modal-error" role="alert"></div></div>${footer?`<div class="dialog-footer">${footer}</div>`:''}${form?'</form>':''}`;
  if (!dialog.open) dialog.showModal();
  dialog.scrollTop=0;
}
function eventFormData(form) {
  const values=Object.fromEntries(new FormData(form));
  return {title:values.title||'Проверка свободных мест',kind:values.kind||'group',status:values.status||'request',
    start:`${values.date}T${values.start_time}`,end:`${values.end_date||values.date}T${values.end_time}`,
    room_id:Number(values.room_id),guests:Number(values.guests),exclusive:values.exclusive==='on',
    contact:values.contact||'',phone:values.phone||'',notes:values.notes||''};
}
function openEvent(existing=null,day=selected,hour=14) {
  const event = existing || {title:'',kind:'group',status:'request',start:`${day}T${String(hour).padStart(2,'0')}:00`,end:`${day}T${String(Math.min(hour+2,23)).padStart(2,'0')}:${hour===23?'59':'00'}`,room_id:Number(roomFilter)||state.rooms[0].id,guests:20,exclusive:false,contact:'',phone:'',notes:''};
  const body=`<label class="field">Название мероприятия<input name="title" value="${escape(event.title)}" maxlength="120" placeholder="Например, группа из Москвы" required></label><div class="field-row"><label class="field">Тип<select name="kind">${Object.entries(kindNames).map(([key,label])=>`<option value="${key}" ${event.kind===key?'selected':''}>${label}</option>`).join('')}</select></label><label class="field">Статус<select name="status">${Object.entries(statusNames).filter(([k])=>existing||k!=='cancelled').map(([key,label])=>`<option value="${key}" ${event.status===key?'selected':''}>${label}</option>`).join('')}</select></label></div>
    <div class="field-row"><label class="field">Дата начала<input name="date" type="date" value="${event.start.slice(0,10)}" required></label><label class="field">Дата окончания<input name="end_date" type="date" value="${event.end.slice(0,10)}" required></label></div>
    <div class="field-row"><label class="field">Начало<input name="start_time" type="time" value="${timeOf(event.start)}" required></label><label class="field">Окончание<input name="end_time" type="time" value="${timeOf(event.end)}" required></label></div>
    <div class="field-row"><label class="field">Зал<select name="room_id">${state.rooms.map(r=>`<option value="${r.id}" ${r.id===event.room_id?'selected':''}>${escape(r.name)} · ${seatCount(r.capacity)}</option>`).join('')}</select></label><label class="field">Число гостей<input name="guests" type="number" min="1" max="100000" step="1" value="${event.guests}" required></label></div>
    <label class="check-field"><input name="exclusive" type="checkbox" ${event.exclusive?'checked':''}><span><strong>Зал целиком</strong><small>Другие группы не смогут забронировать этот зал в выбранное время.</small></span></label><div id="availability" class="availability pending" role="status">${icon('clock')}Проверяем свободные места…</div>
    <div class="field-row"><label class="field">Контактное лицо<input name="contact" maxlength="120" value="${escape(event.contact)}" placeholder="Имя или организация" autocomplete="off"></label><label class="field">Телефон<input name="phone" type="tel" maxlength="40" value="${escape(event.phone)}" placeholder="+7" autocomplete="off"></label></div><label class="field">Комментарий<textarea name="notes" maxlength="4000" placeholder="Меню, особенности группы, пожелания гостей">${escape(event.notes)}</textarea></label><p class="muted small">Время московское. Укажите время подготовки и уборки в интервале бронирования, если зал нужен заранее.</p>${existing?`<p class="muted small">Изменено: ${formatDay(event.updated_at.slice(0,10))}, ${timeOf(event.updated_at)} · версия ${event.version}</p>`:''}`;
  const footer=`${existing&&event.status!=='cancelled'?'<button class="button danger" type="button" id="cancel-booking">Отменить заявку</button>':'<span></span>'}<div><button class="button" type="button" data-action="close">Закрыть</button><button class="button primary" id="save-event" type="submit">${existing?'Сохранить':'Создать заявку'}</button></div>`;
  openDialog(existing?'Карточка мероприятия':'Новая заявка','Ресторан «Дружба» · время московское',body,footer,true);
  const form=$('#modal-form');
  const check=async()=>{
    const seq=++checkSequence;
    const box=$('#availability');
    if(!box) return;
    const data=eventFormData(form);if(existing) data.id=existing.id;
    if(data.status==='cancelled'){box.className='availability pending';box.innerHTML=`${icon('info')}Отменённая заявка не занимает места.`;return;}
    box.className='availability pending';box.innerHTML=`${icon('clock')}Проверяем свободные места…`;
    try{
      const answer=await api('availability',{method:'POST',body:data});
      if(seq!==checkSequence||!dialog.open) return;
      box.className=`availability ${answer.available?'':'blocked'}`;
      box.innerHTML=`${icon(answer.available?'check':'info')}<span>${escape(answer.message)}</span>`;
    }catch(e){if(seq===checkSequence){box.className='availability blocked';box.textContent=e.message;}}
  };
  form.addEventListener('input',e=>{
    if(e.target.name==='date'){
      const oldDay=form.elements.end_date.value;
      if(oldDay===event.start.slice(0,10)||oldDay<form.elements.date.value) form.elements.end_date.value=form.elements.date.value;
    }
    if(e.target.name==='kind') form.elements.exclusive.checked=e.target.value==='banquet';
    clearTimeout(checkTimer);checkTimer=setTimeout(check,350);
  });
  check();
  form.addEventListener('submit',async e=>{
    e.preventDefault();const button=$('#save-event');button.disabled=true;button.textContent='Сохраняем…';
    try{
      const data=eventFormData(form);if(existing)data.version=existing.version;
      await api(existing?`events/${existing.id}`:'events',{method:existing?'PUT':'POST',body:data});
      selected=data.start.slice(0,10);month=parseDay(selected);dialog.close();await refresh(true);toast(LOCAL_DEMO?'Тестовая заявка сохранена на этом устройстве':'Заявка сохранена в общем календаре');
    }catch(error){if($('#modal-error'))$('#modal-error').textContent=error.message;}
    finally{if(button.isConnected){button.disabled=false;button.textContent='Сохранить';}}
  });
  $('#cancel-booking')?.addEventListener('click',()=>{
    const data={...existing,exclusive:Boolean(existing.exclusive),status:'cancelled'};
    openDialog('Отменить заявку?',escape(existing.title),'<p>Места в зале освободятся. Заявка останется в истории со статусом «Отменено».</p>',`<span></span><div><button class="button" data-action="close">Закрыть</button><button class="button danger" id="confirm-cancel">Подтвердить отмену</button></div>`);
    $('#confirm-cancel').addEventListener('click',async e=>{
      e.target.disabled=true;
      try{await api(`events/${existing.id}`,{method:'PUT',body:data});dialog.close();await refresh(true);toast('Заявка отменена. Места освободились.');}
      catch(err){$('#modal-error').textContent=err.message;e.target.disabled=false;}
    });
  });
}

function openAvailability() {
  openDialog('Проверить свободные места','Одна дата, все залы · время московское',`<form id="check-form"><div class="field-row"><label class="field">Дата<input type="date" name="date" value="${selected}" required></label><label class="field">Гостей<input type="number" name="guests" value="20" min="1" max="100000" required></label></div><div class="field-row"><label class="field">Начало<input type="time" name="start_time" value="14:00" required></label><label class="field">Окончание<input type="time" name="end_time" value="16:00" required></label></div><p class="small muted">Проверка в пределах одного дня. Для перехода через полночь используйте новую заявку.</p><button type="submit" class="button primary">${icon('search')}Проверить залы</button></form><div id="check-results"></div>`);
  const form=$('#check-form');form.style.display='contents';
  form.addEventListener('submit',async e=>{
    e.preventDefault();const button=$('button',form);button.disabled=true;$('#modal-error').textContent='';
    try{
      const data=eventFormData(form);
      const results=await Promise.all(state.rooms.map(async r=>({room:r,answer:await api('availability',{method:'POST',body:{...data,room_id:r.id}})})));
      $('#check-results').innerHTML=results.map(({room,answer})=>`<div class="availability ${answer.available?'':'blocked'}"><div><strong>${escape(room.name)}</strong><p>${escape(answer.message)}</p>${answer.available?`<button class="button secondary" data-book-room="${room.id}">Создать заявку</button>`:''}</div></div>`).join('');
      // Availability is advisory. A new booking always rechecks inside a database transaction.
      document.querySelectorAll('[data-book-room]').forEach(b=>b.addEventListener('click',()=>{
        const values=Object.fromEntries(new FormData(form));
        roomFilter=b.dataset.bookRoom;selected=values.date;month=parseDay(selected);
        openEvent(null,selected,Number(values.start_time.slice(0,2)));
        const edit=$('#modal-form');edit.elements.start_time.value=values.start_time;edit.elements.end_time.value=values.end_time;edit.elements.guests.value=values.guests;edit.dispatchEvent(new Event('input',{bubbles:true}));
      }));
    }catch(error){$('#modal-error').textContent=error.message;}
    finally{if(button.isConnected)button.disabled=false;}
  });
}

function openRoom(id=null) {
  const room=state.rooms.find(r=>r.id===id);
  openDialog(room?'Настройки зала':'Новый зал','Укажите фактическую вместимость',`<label class="field">Название<input name="name" maxlength="80" value="${escape(room?.name||'')}" required></label><label class="field">Вместимость<input name="capacity" type="number" min="1" max="100000" step="1" value="${room?.capacity||20}" required></label>`,`<span></span><button class="button primary" type="submit">Сохранить зал</button>`,true);
  bindSimpleForm('rooms',form=>({...Object.fromEntries(new FormData(form)),capacity:Number(form.elements.capacity.value),...(room?{id:room.id,version:room.version}:{})}),'Настройки зала сохранены');
}
function openUser() {
  openDialog('Новый сотрудник','Передайте логин и пароль сотруднику лично',`<label class="field">Имя<input name="name" maxlength="100" required></label><label class="field">Логин<input name="login" pattern="[a-zA-Z0-9_.]{3,80}" maxlength="80" autocapitalize="none" autocomplete="off" required><small>От 3 латинских символов. Разрешены цифры, точка и подчёркивание.</small></label><label class="field">Начальный пароль<input name="password" type="password" minlength="12" maxlength="200" autocomplete="new-password" required><small>Минимум 12 символов.</small></label><label class="field">Права<select name="role"><option value="manager">Менеджер</option><option value="admin">Администратор</option></select></label>`,`<span></span><button class="button primary" type="submit">Создать учётную запись</button>`,true);
  bindSimpleForm('users',form=>Object.fromEntries(new FormData(form)),'Учётная запись создана');
}
function openPassword() {
  openDialog('Изменить пароль','После сохранения потребуется войти снова',`<label class="field">Текущий пароль<input name="old_password" type="password" autocomplete="current-password" maxlength="200" required></label><label class="field">Новый пароль<input name="new_password" type="password" autocomplete="new-password" minlength="12" maxlength="200" required><small>Минимум 12 символов.</small></label>`,`<span></span><button class="button primary" type="submit">Изменить пароль</button>`,true);
  $('#modal-form').addEventListener('submit',async event=>{
    event.preventDefault();const button=$('button[type="submit"]',event.target);button.disabled=true;
    try{await api('password',{method:'POST',body:Object.fromEntries(new FormData(event.target))});state=null;dialog.close();await renderLogin('Пароль изменён. Войдите с новым паролем.');}
    catch(e){$('#modal-error').textContent=e.message;button.disabled=false;}
  });
}
function bindSimpleForm(endpoint,getData,message) {
  $('#modal-form').addEventListener('submit',async event=>{
    event.preventDefault();const button=$('button[type="submit"]',event.target);button.disabled=true;
    try{await api(endpoint,{method:'POST',body:getData(event.target)});dialog.close();await refresh(true);toast(message);}
    catch(error){if($('#modal-error'))$('#modal-error').textContent=error.message;button.disabled=false;}
  });
}
function openInstall() {
  const installNote=LOCAL_DEMO?'Устанавливается тестовая версия. Заявки остаются в браузере этого устройства и не передаются на другие устройства.':'Для установки на телефон нужен адрес общего сервера с HTTPS. Адрес localhost открывается только на этом компьютере.';
  openDialog('Дружба на вашем устройстве','Без App Store и Google Play',`<div class="install-steps"><div class="install-step"><span>${icon('phone')}</span><div><strong>iPhone</strong><p>Откройте адрес приложения в Safari. Нажмите «Поделиться», затем «На экран Домой». Если доступен переключатель «Открывать как веб приложение», включите его.</p></div></div><div class="install-step"><span>${icon('phone')}</span><div><strong>Android</strong><p>Откройте адрес в Chrome. В меню браузера выберите «Установить приложение» или «Добавить на главный экран».</p></div></div><div class="install-step"><span>${icon('building')}</span><div><strong>Компьютер</strong><p>Откройте адрес в Chrome или Edge. Нажмите значок установки в адресной строке или пункт установки в меню браузера.</p></div></div></div><div class="availability pending">${icon('info')}${escape(installNote)}</div>${installPrompt?'<button class="button primary" id="install-now">Установить сейчас</button>':''}`);
  $('#install-now')?.addEventListener('click',async()=>{await installPrompt.prompt();await installPrompt.userChoice;installPrompt=null;dialog.close();});
}
function exportCsv() {
  const rows=[['Дата','Начало','Окончание','Название','Тип','Зал','Гостей','Статус','Контакт','Телефон','Комментарий']];
  visibleEvents(true).filter(e=>(!listFrom||e.end>=`${listFrom}T00:00`)&&(!listTo||e.start<=`${listTo}T23:59`)).forEach(e=>rows.push([e.start.slice(0,10),timeOf(e.start),e.end,e.title,kindNames[e.kind],roomName(e.room_id),e.guests,statusNames[e.status],e.contact,e.phone,e.notes]));
  const cell=value=>{let text=String(value);if(/^[\s]*[=+@\-\t\r]/.test(text))text="'"+text;return `"${text.replace(/"/g,'""')}"`;};
  const blob=new Blob(['\uFEFF'+rows.map(row=>row.map(cell).join(';')).join('\r\n')],{type:'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`druzhba-${todayKey()}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('Список заявок выгружен');
}
async function exportDemo() {
  const data=await api('backup');
  const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`druzhba-demo-${todayKey()}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  toast('Тестовые данные выгружены');
}
function resetDemo() {
  openDialog('Очистить календарь?','Только тестовый календарь на этом устройстве','<p>Все заявки и история их изменений будут удалены. Настройки залов сохранятся. При необходимости сначала скачайте данные в настройках.</p>',`<span></span><div><button class="button" data-action="close">Закрыть</button><button class="button danger" id="confirm-reset">Очистить календарь</button></div>`);
  $('#confirm-reset').addEventListener('click',async event=>{
    event.target.disabled=true;
    try{await api('reset',{method:'POST',body:{}});dialog.close();selected=todayKey();month=parseDay(selected);await refresh(true);toast('Календарь очищен');}
    catch(error){$('#modal-error').textContent=error.message;event.target.disabled=false;}
  });
}
function navigatePeriod(direction) {
  if(view==='month'){month=new Date(month.getFullYear(),month.getMonth()+direction,1,12);selected=dateKey(month);}
  else{const d=parseDay(selected);d.setDate(d.getDate()+direction*(view==='week'?7:1));selected=dateKey(d);month=parseDay(selected);}
  render();
}
function focusAgenda() {
  if (view==='month' && window.matchMedia('(max-width:600px)').matches) {
    requestAnimationFrame(()=>$('.day-panel')?.scrollIntoView({block:'start',behavior:window.matchMedia('(prefers-reduced-motion:reduce)').matches?'auto':'smooth'}));
  }
}

document.addEventListener('click',async event=>{
  const target=event.target.closest('button,[data-day]');if(!target)return;
  try{
    if(target.dataset.page){page=target.dataset.page;search='';render();window.scrollTo({top:0});return;}
    if(target.hasAttribute('data-room')){roomFilter=target.dataset.room;render();return;}
    if(target.dataset.view){view=target.dataset.view;render();return;}
    if(target.dataset.event){const found=state.events.find(e=>e.id===target.dataset.event);if(found)openEvent(found);return;}
    if(target.dataset.newDay){selected=target.dataset.newDay;month=parseDay(selected);openEvent(null,selected);return;}
    if(target.dataset.day){selected=target.dataset.day;month=parseDay(selected);render();focusAgenda();return;}
    if(target.hasAttribute('data-hour')){openEvent(null,selected,Number(target.dataset.hour));return;}
    if(target.dataset.editRoom){openRoom(Number(target.dataset.editRoom));return;}
    switch(target.dataset.action){
      case 'theme':globalThis.DruzhbaTheme?.set(globalThis.DruzhbaTheme.resolved==='dark'?'light':'dark');break;
      case 'new':openEvent();break;
      case 'close':dialog.close();break;
      case 'prev':navigatePeriod(-1);break;
      case 'next':navigatePeriod(1);break;
      case 'today':selected=todayKey();month=parseDay(selected);render();break;
      case 'day-view':view='day';render();break;
      case 'check':openAvailability();break;
      case 'requests':page='bookings';statusFilter='request';render();break;
      case 'install':openInstall();break;
      case 'add-room':openRoom();break;
      case 'add-user':openUser();break;
      case 'password':openPassword();break;
      case 'export':exportCsv();break;
      case 'demo-backup':await exportDemo();break;
      case 'demo-reset':resetDemo();break;
      case 'logout':await api('logout',{method:'POST',body:{}});state=null;previousState='';await renderLogin();break;
      case 'demo':target.disabled=true;await api('demo',{method:'POST',body:{}});await refresh(true);break;
    }
  }catch(error){toast(error.message);target.disabled=false;}
});
document.addEventListener('keydown',event=>{
  const target=event.target;
  if(target.matches('.day-cell')&&['Enter',' '].includes(event.key)){event.preventDefault();selected=target.dataset.day;month=parseDay(selected);render();focusAgenda();}
});
dialog.addEventListener('close',()=>{checkSequence++;clearTimeout(checkTimer);});
window.addEventListener('druzhba-themechange',updateThemeControls);
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();installPrompt=event;});
window.addEventListener('online',()=>{if(state)refresh(true);});
window.addEventListener('offline',()=>{connected=LOCAL_DEMO;updateSync();});
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&state)refresh();});
setInterval(()=>{if(state&&!document.hidden)refresh();},15000);
if('serviceWorker' in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});
(async()=>{
  if(new URLSearchParams(location.search).get('demo')==='1'){
    try{const health=await api('health');if(health.demo)await api('demo',{method:'POST',body:{}});}catch{}
  }
  await refresh(true);
  if(state && new URLSearchParams(location.search).has('new')) openEvent();
})();
