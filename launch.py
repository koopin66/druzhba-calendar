"""Local Windows/macOS/Linux launcher. Keeps the server in the foreground."""
import argparse
import json
import subprocess
import sys
import time
import urllib.error
import urllib.request
import webbrowser
from pathlib import Path

parser=argparse.ArgumentParser()
parser.add_argument('--demo',action='store_true')
args=parser.parse_args()
port=8766 if args.demo else 8765
url=f'http://localhost:{port}/'
command=[sys.executable,str(Path(__file__).parent/'server.py'),'--port',str(port)]
if args.demo:
    command.append('--demo')

def health():
    try:
        with urllib.request.urlopen(url+'api/health',timeout=1) as response:
            result=json.load(response)
            return result.get('ok') and result.get('demo')==args.demo
    except (OSError,ValueError):
        return False

if health():
    webbrowser.open(url+('?demo=1' if args.demo else ''))
    raise SystemExit(0)
process=subprocess.Popen(command,cwd=Path(__file__).parent)
try:
    for _ in range(50):
        if health():
            webbrowser.open(url+('?demo=1' if args.demo else ''))
            break
        if process.poll() is not None:
            raise SystemExit(process.returncode)
        time.sleep(.1)
    else:
        print('Could not open calendar. Check the server output above.')
    process.wait()
except KeyboardInterrupt:
    process.terminate()
    process.wait()
