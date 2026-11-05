import concurrent.futures
import contextlib
import http.client
import io
import json
import os
import sqlite3
import sys
import tempfile
import threading
import unittest
from pathlib import Path

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import server


class CalendarTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.http=server.ThreadingHTTPServer(('127.0.0.1',0),server.Handler)
        cls.http.daemon_threads=True
        cls.port=cls.http.server_address[1]
        cls.thread=threading.Thread(target=cls.http.serve_forever,daemon=True)
        cls.thread.start()
        cls.temp_dirs=[]

    @classmethod
    def tearDownClass(cls):
        cls.http.shutdown()
        cls.http.server_close()
        for directory in cls.temp_dirs:
            directory.cleanup()

    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.temp_dirs.append(self.temp)
        server.DB=Path(self.temp.name)/'calendar.sqlite3'
        server.DEMO=False
        os.environ['DRUZHBA_ADMIN_PASSWORD']='initial-test-password-123'
        with contextlib.redirect_stdout(io.StringIO()):
            server.initialize()
        status,_,headers=self.request('POST','/api/login',{'login':'admin','password':'initial-test-password-123'})
        self.assertEqual(status,200)
        self.cookie=headers['Set-Cookie'].split(';')[0]

    def tearDown(self):
        os.environ.pop('DRUZHBA_ADMIN_PASSWORD',None)

    def request(self,method,path,body=None,cookie=None,headers=None,raw=False):
        connection=http.client.HTTPConnection('127.0.0.1',self.port,timeout=15)
        supplied={'X-Druzhba-Request':'1','Content-Type':'application/json'}
        if cookie:
            supplied['Cookie']=cookie
        if headers:
            supplied.update(headers)
        connection.request(method,path,json.dumps(body) if body is not None else None,supplied)
        response=connection.getresponse()
        content=response.read()
        result=(response.status,content if raw else json.loads(content),dict(response.headers))
        connection.close()
        return result

    def booking(self,**changes):
        item=dict(title='Группа из Москвы',kind='group',status='confirmed',
            start='2027-01-05T14:00',end='2027-01-05T16:00',room_id=1,guests=46,
            exclusive=False,contact='Менеджер группы',phone='+7 000 000 00 00',notes='Тест')
        item.update(changes)
        return item

    def save(self,item):
        return self.request('POST','/api/events',item,self.cookie)

    def test_login_and_private_state(self):
        self.assertEqual(self.request('GET','/api/state')[0],401)
        status,data,_=self.request('GET','/api/state',cookie=self.cookie)
        self.assertEqual(status,200)
        self.assertEqual(data['user']['role'],'admin')
        self.assertNotIn('password',data['user'])

    def test_bad_login_and_csrf(self):
        self.assertEqual(self.request('POST','/api/login',{'login':'admin','password':'wrong'})[0],401)
        self.assertEqual(self.request('POST','/api/events',self.booking(),self.cookie,{'Origin':'https://hostile.test'})[0],403)
        self.assertEqual(self.request('POST','/api/events',self.booking(),self.cookie,{'X-Druzhba-Request':''})[0],403)
        self.assertEqual(self.request('POST','/api/demo',{})[0],404)

    def test_january_fifth_capacity(self):
        self.assertEqual(self.save(self.booking())[0],201)
        status,data,_=self.request('POST','/api/availability',self.booking(guests=27),self.cookie)
        self.assertEqual(status,200)
        self.assertFalse(data['available'])
        self.assertEqual(data['remaining'],26)
        self.assertEqual(self.save(self.booking(guests=27))[0],409)
        self.assertEqual(self.save(self.booking(guests=26))[0],201)

    def test_adjacent_events_and_different_rooms(self):
        self.save(self.booking(exclusive=True))
        self.assertEqual(self.save(self.booking(start='2027-01-05T16:00',end='2027-01-05T18:00'))[0],201)
        self.assertEqual(self.save(self.booking(room_id=2,guests=20))[0],201)

    def test_exclusive_prevents_overlap_in_both_directions(self):
        _,first,_=self.save(self.booking())
        self.assertEqual(self.save(self.booking(exclusive=True,guests=2))[0],409)
        self.request('PUT',f'/api/events/{first["id"]}',{**self.booking(), 'status':'cancelled','version':first['version']},self.cookie)
        self.assertEqual(self.save(self.booking(exclusive=True,guests=2))[0],201)
        self.assertEqual(self.save(self.booking(guests=2))[0],409)

    def test_peak_capacity_not_sum_of_sequential_groups(self):
        self.save(self.booking(guests=50,start='2027-01-05T12:00',end='2027-01-05T14:00'))
        self.save(self.booking(guests=50,start='2027-01-05T14:00',end='2027-01-05T16:00'))
        self.assertEqual(self.save(self.booking(guests=22,start='2027-01-05T13:00',end='2027-01-05T15:00'))[0],201)

    def test_pending_reserves_capacity(self):
        self.assertEqual(self.save(self.booking(status='request',guests=70))[0],201)
        self.assertEqual(self.save(self.booking(guests=11))[0],409)

    def test_edit_conflict_and_cancellation(self):
        _,event,_=self.save(self.booking(exclusive=True))
        update={**self.booking(exclusive=True),'version':event['version'],'title':'Обновлено'}
        self.assertEqual(self.request('PUT',f'/api/events/{event["id"]}',update,self.cookie)[0],200)
        self.assertEqual(self.request('PUT',f'/api/events/{event["id"]}',update,self.cookie)[0],409)
        update.update(version=2,status='cancelled')
        self.assertEqual(self.request('PUT',f'/api/events/{event["id"]}',update,self.cookie)[0],200)
        self.assertEqual(self.save(self.booking())[0],201)

    def test_concurrent_booking_is_atomic(self):
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            results=list(pool.map(lambda _:self.save(self.booking(guests=60))[0],range(2)))
        self.assertEqual(sorted(results),[201,409])

    def test_invalid_and_overnight_events(self):
        for item in [self.booking(guests=-1),self.booking(guests=1.5),self.booking(room_id=999),
                     self.booking(end='2027-01-05T13:59'),self.booking(start='2027-02-30T14:00'),
                     self.booking(end='2027-01-08T14:00')]:
            self.assertEqual(self.save(item)[0],400)
        self.assertEqual(self.save(self.booking(start='2027-01-05T22:00',end='2027-01-06T02:00'))[0],201)

    def test_room_capacity_cannot_break_existing_bookings(self):
        self.save(self.booking())
        status,_,_=self.request('POST','/api/rooms',dict(id=1,version=1,name='Основной зал',capacity=45),self.cookie)
        self.assertEqual(status,409)
        self.assertEqual(self.request('POST','/api/rooms',dict(id=1,version=1,name='Большой зал',capacity=90),self.cookie)[0],200)
        self.assertEqual(self.request('POST','/api/rooms',dict(id=1,version=1,name='Старое имя',capacity=90),self.cookie)[0],409)

    def test_manager_permissions(self):
        self.assertEqual(self.request('POST','/api/users',dict(name='Менеджер',login='manager',password='manager-test-password',role='manager'),self.cookie)[0],201)
        _,_,headers=self.request('POST','/api/login',dict(login='manager',password='manager-test-password'))
        cookie=headers['Set-Cookie'].split(';')[0]
        self.assertEqual(self.request('POST','/api/events',self.booking(),cookie)[0],201)
        self.assertEqual(self.request('GET','/api/backup',cookie=cookie)[0],403)
        self.assertEqual(self.request('POST','/api/rooms',dict(name='Другой зал',capacity=10),cookie)[0],403)

    def test_backup_is_consistent_and_logout_invalidates_session(self):
        self.save(self.booking())
        status,data,_=self.request('GET','/api/backup',cookie=self.cookie,raw=True)
        self.assertEqual(status,200)
        backup=Path(self.temp.name)/'restore.sqlite3';backup.write_bytes(data)
        with contextlib.closing(sqlite3.connect(backup)) as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM events').fetchone()[0],1)
        self.request('POST','/api/logout',{},self.cookie)
        self.assertEqual(self.request('GET','/api/state',cookie=self.cookie)[0],401)

    def test_password_change_revokes_all_sessions(self):
        self.assertEqual(self.request('POST','/api/password',dict(old_password='initial-test-password-123',new_password='new-long-password-123'),self.cookie)[0],200)
        self.assertEqual(self.request('GET','/api/state',cookie=self.cookie)[0],401)
        self.assertEqual(self.request('POST','/api/login',dict(login='admin',password='new-long-password-123'))[0],200)

    def test_static_security_and_pwa_files(self):
        status,html,headers=self.request('GET','/',raw=True)
        self.assertEqual(status,200)
        self.assertIn('Content-Security-Policy',headers)
        self.assertIn('Дружба'.encode(),html)
        self.assertEqual(self.request('GET','/../server.py',raw=True)[0],404)
        self.assertEqual(self.request('GET','/missing',raw=True)[0],404)
        self.assertEqual(self.request('GET','/manifest.webmanifest')[1]['display'],'standalone')
        for file in ('icon-192.png','icon-512.png','sw.js','app.js','style.css','manrope.ttf'):
            self.assertEqual(self.request('GET','/'+file,raw=True)[0],200)


if __name__=='__main__':
    unittest.main(verbosity=2)
