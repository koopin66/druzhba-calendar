import json
import re
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]

class DemoBuildTests(unittest.TestCase):
    def test_subdirectory_assets_exist(self):
        html=(ROOT/'docs/index.html').read_text(encoding='utf-8')
        self.assertNotIn('src="/',html)
        for path in re.findall(r'(?:src|href)="\./([^"?#]+)"',html):
            self.assertTrue((ROOT/'docs'/path).is_file(),path)
        self.assertLess(html.index('demo-runtime.js'),html.index('src="./app.js"'))
        self.assertLess(html.index('src="./theme.js"'),html.index('href="./style.css"'))
        self.assertIn('href="./dark.css"',html)

    def test_pwa_scope_and_shortcuts_use_relative_paths(self):
        manifest=json.loads((ROOT/'docs/manifest.webmanifest').read_text(encoding='utf-8'))
        self.assertEqual(manifest['scope'],'./')
        self.assertEqual(manifest['start_url'],'./')
        self.assertEqual(manifest['shortcuts'][0]['url'],'./?new=1')
        for icon in manifest['icons']:
            self.assertTrue((ROOT/'docs'/icon['src']).is_file())
        self.assertTrue(all('v2' in icon['src'] for icon in manifest['icons']))
        self.assertTrue(any(icon.get('purpose')=='maskable' for icon in manifest['icons']))

    def test_only_safe_public_files_are_published(self):
        forbidden={'.env','server.py','calendar.sqlite3','demo.sqlite3'}
        files={p.name for p in (ROOT/'docs').rglob('*') if p.is_file()}
        self.assertFalse(files & forbidden)
        self.assertTrue((ROOT/'docs/.nojekyll').exists())
        self.assertIn('PREFIX', (ROOT/'docs/sw.js').read_text(encoding='utf-8'))

if __name__=='__main__':
    unittest.main()
