"""Дружба: shared booking calendar. Python 3.11+, standard library only."""
import argparse
import hashlib
import hmac
import json
import mimetypes
import os
import re
import secrets
import sqlite3
import threading
import time
from contextlib import closing, contextmanager
from datetime import datetime, timedelta, timezone
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent
PUBLIC = ROOT / 'public'
DB = ROOT / 'data' / 'calendar.sqlite3'
DEMO = False
SECURE = os.environ.get('DRUZHBA_SECURE_COOKIE') == '1'
RATE_LOCK = threading.Lock()
ATTEMPTS = {}
MSK = timezone(timedelta(hours=3))


class Problem(Exception):
    def __init__(self, message, status=400):
        self.message, self.status = message, status


@contextmanager
def connect():
    db = sqlite3.connect(DB, timeout=15)
    db.row_factory = sqlite3.Row
    db.execute('PRAGMA foreign_keys=ON')
    try:
        with db:
            yield db
    finally:
        db.close()


def password_hash(password, salt=None):
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac('sha256', password.encode(), salt.encode(), 310000).hex()
    return f'{salt}:{digest}'


def password_matches(password, stored):
    return hmac.compare_digest(password_hash(password, stored.split(':')[0]), stored)


def initialize():
    DB.parent.mkdir(parents=True, exist_ok=True)
    with connect() as db:
        db.execute('PRAGMA journal_mode=WAL')
        db.executescript('''
          CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY, name TEXT NOT NULL, login TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','manager')));
          CREATE TABLE IF NOT EXISTS sessions (
            token TEXT PRIMARY KEY, user_id INTEGER REFERENCES users(id), expires REAL NOT NULL);
          CREATE TABLE IF NOT EXISTS rooms (
            id INTEGER PRIMARY KEY, name TEXT NOT NULL, capacity INTEGER NOT NULL, version INTEGER NOT NULL DEFAULT 1);
          CREATE TABLE IF NOT EXISTS events (
            id TEXT PRIMARY KEY, title TEXT NOT NULL, kind TEXT NOT NULL,
            start TEXT NOT NULL, end TEXT NOT NULL, room_id INTEGER NOT NULL REFERENCES rooms(id),
            guests INTEGER NOT NULL, exclusive INTEGER NOT NULL, status TEXT NOT NULL,
            contact TEXT NOT NULL, phone TEXT NOT NULL, notes TEXT NOT NULL,
            version INTEGER NOT NULL DEFAULT 1, updated_by INTEGER REFERENCES users(id), updated_at TEXT NOT NULL);
          CREATE INDEX IF NOT EXISTS event_time ON events(room_id,start,end);
          CREATE TABLE IF NOT EXISTS audit (
            id INTEGER PRIMARY KEY, at TEXT NOT NULL, user_id INTEGER REFERENCES users(id),
            action TEXT NOT NULL, details TEXT NOT NULL);
        ''')
        if not db.execute('SELECT 1 FROM rooms').fetchone():
            db.executemany('INSERT INTO rooms(name,capacity) VALUES (?,?)', [('Зал 1', 72), ('Зал 2', 55)])
        if not db.execute('SELECT 1 FROM users').fetchone():
            password = os.environ.get('DRUZHBA_ADMIN_PASSWORD') or secrets.token_urlsafe(14)
            if len(password) < 12:
                raise SystemExit('DRUZHBA_ADMIN_PASSWORD must contain at least 12 characters')
            db.execute('INSERT INTO users(name,login,password,role) VALUES (?,?,?,?)',
                       ('Команда ресторана', 'admin', password_hash(password), 'admin'))
            if not DEMO:
                print(f'FIRST LOGIN: admin\nONE-TIME INITIAL PASSWORD: {password}\nChange it in Settings after login.', flush=True)
        if DEMO and not db.execute('SELECT 1 FROM events').fetchone():
            seed_demo(db)


def seed_demo(db):
    now = datetime.now(MSK)
    days = [2, 3, 5, 5, 7, 9, 11, 12, 14, 16, 18, 20, 21, 23, 25, 27, 28]
    names = ['Обед туристической группы', 'Семейный юбилей', 'Группа «Северный маршрут»',
             'День рождения', 'Свадебный ужин', 'Группа из Петербурга', 'Деловой завтрак',
             'Обед экскурсионной группы', 'Юбилей компании', 'Группа «Балтика»',
             'Встреча выпускников', 'Семейный праздник', 'Группа из Москвы',
             'Ужин делегации', 'День рождения', 'Обед туристической группы', 'Свадебный банкет']
    for i, (day, title) in enumerate(zip(days, names)):
        is_group = any(word in title for word in ('Группа','группы','завтрак','делегации'))
        room = 1 if is_group or i % 2 == 0 else 2
        hour = 13 if is_group else 18
        start = now.replace(day=day, hour=hour, minute=0, second=0, microsecond=0)
        end = start + timedelta(hours=2 if is_group else 4)
        item = dict(title=title, kind='group' if is_group else 'banquet',
                    start=start.strftime('%Y-%m-%dT%H:%M'), end=end.strftime('%Y-%m-%dT%H:%M'),
                    room_id=room, guests=32 if is_group else (18 if room == 2 else 48),
                    exclusive=not is_group, status='request' if i % 5 == 0 else 'confirmed',
                    contact='Демонстрационный контакт', phone='', notes='Пример заявки. Данные вымышлены.')
        save_event(db, item, 1)
    jan = now.year + 1
    save_event(db, dict(title='Новогодняя туристическая группа',kind='group',
               start=f'{jan}-01-05T14:00',end=f'{jan}-01-05T16:00',room_id=1,guests=46,
               exclusive=False,status='confirmed',contact='Демонстрационный контакт',phone='',
               notes='Пример для проверки свободных мест на 5 января.'), 1)


def audit(db, user_id, action, details):
    db.execute('INSERT INTO audit(at,user_id,action,details) VALUES (?,?,?,?)',
               (datetime.now(MSK).isoformat(timespec='seconds'), user_id, action, details))


def text_field(data, key, limit, required=False):
    value = data.get(key, '')
    if not isinstance(value, str) or len(value) > limit:
        raise Problem(f'Поле «{key}» слишком длинное или имеет неверный формат.')
    value = value.strip()
    if required and not value:
        raise Problem('Укажите название мероприятия.')
    return value


def validate_event(data):
    result = {k: text_field(data, k, n, k == 'title') for k,n in
              [('title',120),('contact',120),('phone',40),('notes',4000)]}
    for key in ('kind', 'status'):
        choices = ('group','banquet','meeting') if key == 'kind' else ('request','confirmed','cancelled')
        if data.get(key) not in choices:
            raise Problem('Выберите тип и статус мероприятия.')
        result[key] = data[key]
    for key in ('start', 'end'):
        value = data.get(key, '')
        if not isinstance(value, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}', value):
            raise Problem('Проверьте дату и время.')
        try:
            datetime.fromisoformat(value)
        except ValueError:
            raise Problem('Проверьте дату и время.')
        result[key] = value
    delta = datetime.fromisoformat(result['end']) - datetime.fromisoformat(result['start'])
    if delta <= timedelta() or delta > timedelta(hours=48):
        raise Problem('Окончание должно быть позже начала. Максимальная длительность — 48 часов.')
    for key in ('guests','room_id'):
        if type(data.get(key)) is not int or data[key] < 1 or data[key] > 100000:
            raise Problem('Укажите зал и положительное целое число гостей.')
        result[key] = data[key]
    if type(data.get('exclusive')) is not bool:
        raise Problem('Проверьте режим бронирования зала.')
    result['exclusive'] = int(data['exclusive'])
    return result


def availability(db, item, exclude=''):
    room = db.execute('SELECT * FROM rooms WHERE id=?', (item['room_id'],)).fetchone()
    if not room:
        raise Problem('Зал не найден.')
    others = db.execute('''SELECT * FROM events WHERE room_id=? AND status!='cancelled'
                           AND id!=? AND start<? AND end>?''',
                        (item['room_id'],exclude,item['end'],item['start'])).fetchall()
    points = []
    for event in others:
        points.extend([(max(item['start'],event['start']), event['guests']),
                       (min(item['end'],event['end']), -event['guests'])])
    occupied, peak = 0, 0
    # At equal boundaries departures precede arrivals; adjacent bookings never overlap.
    for _, change in sorted(points, key=lambda p:(p[0],p[1])):
        occupied += change
        peak = max(peak, occupied)
    blocked = bool(others) and (bool(item['exclusive']) or any(x['exclusive'] for x in others))
    remaining = 0 if blocked else max(0, room['capacity'] - peak)
    allowed = not blocked and item['guests'] <= remaining
    reason = ('Зал уже занят в это время. Выберите другой зал или время.' if blocked else
              f'На это время свободно {remaining} мест из {room["capacity"]}.' if not allowed else
              f'Можно принять. После бронирования останется {remaining-item["guests"]} мест.')
    return dict(available=allowed, remaining=remaining, capacity=room['capacity'], message=reason,
                overlaps=[dict(id=x['id'],title=x['title'],start=x['start'],end=x['end'],guests=x['guests']) for x in others])


def save_event(db, data, user_id, event_id=None):
    item = validate_event(data)
    old = None
    if event_id:
        old = db.execute('SELECT * FROM events WHERE id=?', (event_id,)).fetchone()
        if not old:
            raise Problem('Заявка не найдена.',404)
        if type(data.get('version')) is not int or data['version'] != old['version']:
            raise Problem('Другой сотрудник уже изменил заявку. Закройте карточку и откройте её заново.',409)
    check = availability(db, item, event_id or '')
    if item['status'] != 'cancelled' and not check['available']:
        raise Problem(check['message'],409)
    item.update(id=event_id or secrets.token_hex(12), version=old['version']+1 if old else 1,
                updated_by=user_id,updated_at=datetime.now(MSK).isoformat(timespec='seconds'))
    if old:
        fields = ','.join(f'{key}=:{key}' for key in item if key != 'id')
        db.execute(f'UPDATE events SET {fields} WHERE id=:id', item)
    else:
        keys = ','.join(item)
        db.execute(f'INSERT INTO events ({keys}) VALUES ({",".join(":"+k for k in item)})', item)
    audit(db,user_id,'Изменена заявка' if old else 'Создана заявка',item['title'])
    return item


class Handler(BaseHTTPRequestHandler):
    server_version = 'Druzhba/1.0'

    def log_message(self, format, *args):
        # Request paths may contain personal data. Keep access logs minimal.
        if args and str(args[1] if len(args)>1 else '').startswith('5'):
            super().log_message(format,*args)

    def send(self, body, status=200, content_type='application/json; charset=utf-8', cookie=None):
        if not isinstance(body,bytes):
            body = json.dumps(body, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header('Content-Type',content_type)
        self.send_header('Content-Length',str(len(body)))
        self.send_header('Cache-Control','no-store' if self.path.startswith('/api/') else 'no-cache')
        self.send_header('X-Content-Type-Options','nosniff')
        self.send_header('X-Frame-Options','DENY')
        self.send_header('Referrer-Policy','same-origin')
        self.send_header('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'")
        if cookie:
            self.send_header('Set-Cookie',cookie)
        self.end_headers()
        self.wfile.write(body)

    def body(self):
        try:
            length = int(self.headers.get('Content-Length','0'))
            if length < 1 or length > 24000:
                raise Problem('Неверный размер запроса.')
            value = json.loads(self.rfile.read(length))
            if not isinstance(value,dict):
                raise ValueError()
            return value
        except (ValueError,UnicodeDecodeError):
            raise Problem('Не удалось прочитать запрос.')

    def session(self,db):
        cookies = SimpleCookie()
        try:
            cookies.load(self.headers.get('Cookie',''))
            token = cookies['druzhba_session'].value
        except (KeyError,ValueError):
            raise Problem('Войдите в приложение.',401)
        user = db.execute('''SELECT u.id,u.name,u.login,u.role FROM users u JOIN sessions s ON u.id=s.user_id
                             WHERE s.token=? AND s.expires>?''',
                          (hashlib.sha256(token.encode()).hexdigest(),time.time())).fetchone()
        if not user:
            raise Problem('Сессия завершена. Войдите снова.',401)
        return dict(user)

    def cookie(self,token,max_age=604800):
        return f'druzhba_session={token}; HttpOnly; SameSite=Strict; Path=/; Max-Age={max_age}' + ('; Secure' if SECURE else '')

    def do_GET(self):
        try:
            path = urlsplit(self.path).path
            if not path.startswith('/api/'):
                file = (PUBLIC / ('index.html' if path=='/' else path.lstrip('/'))).resolve()
                if not file.is_relative_to(PUBLIC.resolve()) or not file.is_file():
                    return self.send((PUBLIC/'404.html').read_bytes(),404,'text/html; charset=utf-8')
                mime = mimetypes.guess_type(str(file))[0] or 'application/octet-stream'
                if file.suffix == '.webmanifest':
                    mime = 'application/manifest+json'
                return self.send(file.read_bytes(),content_type=mime)
            with connect() as db:
                if path == '/api/health':
                    return self.send(dict(ok=True,demo=DEMO))
                user = self.session(db)
                if path == '/api/state':
                    return self.send(dict(user=user,demo=DEMO,timezone='Europe/Moscow',
                        events=[dict(x) for x in db.execute('SELECT * FROM events ORDER BY start')],
                        rooms=[dict(x) for x in db.execute('SELECT * FROM rooms ORDER BY id')]))
                if user['role'] != 'admin':
                    raise Problem('Доступно администратору.',403)
                if path == '/api/users':
                    return self.send([dict(x) for x in db.execute('SELECT id,name,login,role FROM users ORDER BY id')])
                if path == '/api/audit':
                    return self.send([dict(x) for x in db.execute('''SELECT a.at,a.action,a.details,u.name FROM audit a
                              LEFT JOIN users u ON a.user_id=u.id ORDER BY a.id DESC LIMIT 100''')])
                if path == '/api/backup':
                    # SQLite online backup creates a consistent snapshot, including WAL data.
                    import tempfile
                    with tempfile.TemporaryDirectory() as folder:
                        target = Path(folder)/'backup.sqlite3'
                        with closing(sqlite3.connect(target)) as dest:
                            db.backup(dest)
                        return self.send(target.read_bytes(),content_type='application/vnd.sqlite3')
                raise Problem('Раздел не найден.',404)
        except Problem as error:
            self.send(dict(error=error.message),error.status)
        except (sqlite3.Error,OSError):
            self.send(dict(error='Не удалось прочитать данные. Попробуйте снова.'),500)

    def do_POST(self):
        self.mutate()

    def do_PUT(self):
        self.mutate()

    def mutate(self):
        try:
            # Browser writes must be same-origin. Non-browser API clients require the explicit header.
            origin = self.headers.get('Origin')
            allowed = os.environ.get('DRUZHBA_ORIGIN') or f'{"https" if SECURE else "http"}://{self.headers.get("Host", "")}'
            if (origin and origin != allowed) or self.headers.get('X-Druzhba-Request') != '1':
                raise Problem('Запрос отклонён. Обновите страницу.',403)
            data = self.body()
            path = urlsplit(self.path).path
            with connect() as db:
                db.execute('BEGIN IMMEDIATE')
                if path in ('/api/login','/api/demo') and self.command == 'POST':
                    if path == '/api/demo':
                        if not DEMO:
                            raise Problem('Демонстрационный режим выключен.',404)
                        user = db.execute('SELECT * FROM users WHERE id=1').fetchone()
                    else:
                        # Key by socket peer, never untrusted forwarded headers.
                        peer = self.client_address[0]
                        with RATE_LOCK:
                            attempts = [x for x in ATTEMPTS.get(peer,[]) if time.time()-x<300]
                            if len(attempts)>=15:
                                raise Problem('Слишком много попыток. Повторите через 5 минут.',429)
                            attempts.append(time.time())
                            ATTEMPTS[peer] = attempts
                        login = text_field(data,'login',80).lower()
                        password = text_field(data,'password',200)
                        user = db.execute('SELECT * FROM users WHERE login=?',(login,)).fetchone()
                        if not user or not password_matches(password,user['password']):
                            raise Problem('Неверный логин или пароль.',401)
                        with RATE_LOCK:
                            ATTEMPTS.pop(peer,None)
                    token = secrets.token_urlsafe(40)
                    db.execute('DELETE FROM sessions WHERE expires<?',(time.time(),))
                    db.execute('INSERT INTO sessions VALUES (?,?,?)',
                               (hashlib.sha256(token.encode()).hexdigest(),user['id'],time.time()+604800))
                    db.commit()
                    return self.send(dict(ok=True),cookie=self.cookie(token))
                user = self.session(db)
                if path == '/api/logout' and self.command=='POST':
                    cookies = SimpleCookie(self.headers.get('Cookie',''))
                    token = cookies['druzhba_session'].value
                    db.execute('DELETE FROM sessions WHERE token=?',(hashlib.sha256(token.encode()).hexdigest(),))
                    db.commit()
                    return self.send(dict(ok=True),cookie=self.cookie('',0))
                if path == '/api/availability' and self.command=='POST':
                    item = validate_event(data)
                    return self.send(availability(db,item,data.get('id','')))
                if path == '/api/events' and self.command=='POST':
                    event = save_event(db,data,user['id'])
                    db.commit()
                    return self.send(event,201)
                if re.fullmatch(r'/api/events/[a-f0-9]{24}',path) and self.command=='PUT':
                    event = save_event(db,data,user['id'],path.rsplit('/',1)[1])
                    db.commit()
                    return self.send(event)
                if path == '/api/password' and self.command=='POST':
                    old = text_field(data,'old_password',200)
                    new = text_field(data,'new_password',200)
                    stored = db.execute('SELECT password FROM users WHERE id=?',(user['id'],)).fetchone()[0]
                    if not password_matches(old,stored):
                        raise Problem('Текущий пароль неверен.')
                    if len(new)<12:
                        raise Problem('Новый пароль должен содержать минимум 12 символов.')
                    if DEMO:
                        raise Problem('Смена пароля недоступна в демоверсии.')
                    db.execute('UPDATE users SET password=? WHERE id=?',(password_hash(new),user['id']))
                    db.execute('DELETE FROM sessions WHERE user_id=?',(user['id'],))
                    audit(db,user['id'],'Изменён пароль',user['name'])
                    db.commit()
                    return self.send(dict(ok=True),cookie=self.cookie('',0))
                if user['role']!='admin':
                    raise Problem('Доступно администратору.',403)
                if path=='/api/users' and self.command=='POST':
                    name = text_field(data,'name',100,True)
                    login = text_field(data,'login',80,True).lower()
                    password = text_field(data,'password',200,True)
                    if not re.fullmatch(r'[a-z0-9_.]{3,80}',login) or len(password)<12:
                        raise Problem('Логин: от 3 латинских символов, цифры, точка, подчёркивание. Пароль: от 12 символов.')
                    role = data.get('role','manager')
                    if role not in ('manager','admin'):
                        raise Problem('Неверная роль.')
                    try:
                        db.execute('INSERT INTO users(name,login,password,role) VALUES (?,?,?,?)',
                                   (name,login,password_hash(password),role))
                    except sqlite3.IntegrityError:
                        raise Problem('Этот логин уже занят.')
                    audit(db,user['id'],'Добавлен сотрудник',name)
                    db.commit()
                    return self.send(dict(ok=True),201)
                if path=='/api/rooms' and self.command=='POST':
                    name = text_field(data,'name',80,True)
                    capacity = data.get('capacity')
                    if type(capacity) is not int or not 1<=capacity<=100000:
                        raise Problem('Укажите вместимость от 1 до 100000.')
                    if data.get('id'):
                        room = db.execute('SELECT * FROM rooms WHERE id=?',(data['id'],)).fetchone()
                        if not room or data.get('version') != room['version']:
                            raise Problem('Настройки зала изменены. Обновите страницу.',409)
                        # Reject reducing capacity below any existing active booking peak.
                        marks=[]
                        for e in db.execute("SELECT * FROM events WHERE room_id=? AND status!='cancelled'",(room['id'],)):
                            marks.extend([(e['start'],e['guests']),(e['end'],-e['guests'])])
                        load=0
                        for _,amount in sorted(marks,key=lambda x:(x[0],x[1])):
                            load+=amount
                            if load>capacity:
                                raise Problem('В существующих заявках уже больше гостей. Сначала измените заявки.',409)
                        db.execute('UPDATE rooms SET name=?,capacity=?,version=version+1 WHERE id=?',(name,capacity,room['id']))
                    else:
                        db.execute('INSERT INTO rooms(name,capacity) VALUES (?,?)',(name,capacity))
                    audit(db,user['id'],'Обновлён зал',name)
                    db.commit()
                    return self.send(dict(ok=True))
                raise Problem('Действие не найдено.',404)
        except Problem as error:
            self.send(dict(error=error.message),error.status)
        except (sqlite3.Error,OSError):
            self.send(dict(error='Не удалось сохранить данные. Попробуйте снова.'),500)


def main():
    global DB, DEMO
    parser = argparse.ArgumentParser(description='Дружба — календарь ресторана')
    parser.add_argument('--host',default='127.0.0.1')
    parser.add_argument('--port',type=int,default=8765)
    parser.add_argument('--database',type=Path)
    parser.add_argument('--demo',action='store_true')
    args = parser.parse_args()
    DEMO = args.demo
    if args.database:
        DB = args.database.resolve()
    elif DEMO:
        DB = ROOT/'data'/'demo.sqlite3'
    if args.host not in ('127.0.0.1','localhost','::1') and not SECURE:
        raise SystemExit('External access requires HTTPS proxy and DRUZHBA_SECURE_COOKIE=1. See deploy/README.md.')
    initialize()
    server = ThreadingHTTPServer((args.host,args.port),Handler)
    server.daemon_threads = True
    print(f'Druzhba: http://{args.host}:{args.port} | {"DEMO" if DEMO else "LIVE"} | Ctrl+C to stop',flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__=='__main__':
    main()
