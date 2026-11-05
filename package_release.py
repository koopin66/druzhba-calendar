"""Package source and setup; never include runtime databases or credentials."""
from pathlib import Path
import zipfile

root=Path(__file__).resolve().parent
archive=root.parent/'Druzhba-calendar.zip'
excluded={'data','backups','__pycache__','.git','.codex','.agents','screenshots'}
files=[p for p in root.rglob('*') if p.is_file() and not any(part in excluded for part in p.relative_to(root).parts)
       and p.name!='.env' and p.suffix not in ('.pyc','.zip','.sqlite3','.db','.log')]
with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as output:
    for file in sorted(files):
        output.write(file,Path('druzhba-app')/file.relative_to(root))
with zipfile.ZipFile(archive) as check:
    if check.testzip():
        raise SystemExit('Archive integrity failed')
    assert not any('/data/' in n or n.endswith('.env') for n in check.namelist())
print(f'{archive}\n{len(files)} files; {archive.stat().st_size} bytes; no runtime data')
