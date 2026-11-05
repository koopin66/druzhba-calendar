"""Consistent SQLite backup; no password or session export via a third party."""
import argparse
import sqlite3
from contextlib import closing
from datetime import datetime
from pathlib import Path

parser=argparse.ArgumentParser()
parser.add_argument('--database',type=Path,default=Path('data/calendar.sqlite3'))
parser.add_argument('--directory',type=Path,default=Path('backups'))
args=parser.parse_args()
source=args.database.resolve()
if not source.is_file():
    raise SystemExit('Database not found.')
args.directory.mkdir(parents=True,exist_ok=True)
target=args.directory/f'druzhba-{datetime.now():%Y%m%d-%H%M%S-%f}.sqlite3'
with closing(sqlite3.connect(source)) as db, closing(sqlite3.connect(target)) as output:
    db.backup(output)
    output.execute('DELETE FROM sessions')
    output.commit()
    if output.execute('PRAGMA integrity_check').fetchone()[0]!='ok':
        raise SystemExit('Backup integrity check failed.')
print(target.resolve())
