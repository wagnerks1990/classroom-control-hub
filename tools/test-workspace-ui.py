"""Exercise workspace DOM behavior in Chromium using isolated, mocked operator pages.
No live controller, credentials, classroom data, or hardware are contacted.
Requires Python Playwright and a Chromium installation.
"""
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import os
import threading
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        route = self.path.split('?', 1)[0]
        files = {
            '/controller/': ('test/fixtures/workspace-controller.html', 'text/html'),
            '/controller/display.html': ('test/fixtures/workspace-display.html', 'text/html'),
            '/shared/workspace.js': ('public/shared/workspace.js', 'text/javascript'),
            '/shared/workspace.css': ('public/shared/workspace.css', 'text/css'),
        }
        if route not in files:
            self.send_error(404)
            return
        name, mime = files[route]
        data = (ROOT / name).read_bytes()
        self.send_response(200)
        self.send_header('Content-Type', mime + '; charset=utf-8')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)
    def log_message(self, *_):
        pass

@contextmanager
def server():
    httpd = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    try:
        yield f'http://127.0.0.1:{httpd.server_port}'
    finally:
        httpd.shutdown()
        httpd.server_close()
        thread.join()

def main():
    with server() as base, sync_playwright() as p:
        executable = os.environ.get('CHROMIUM_PATH')
        if not executable and Path('/usr/bin/chromium').exists():
            executable = '/usr/bin/chromium'
        browser = p.chromium.launch(headless=True, executable_path=executable)
        page = browser.new_page(viewport={'width': 1440, 'height': 1100})
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        def ready():
            expect(page.locator('html')).to_have_class('hub-ui')
        page.goto(base + '/controller/')
        ready()
        expect(page.locator('.hub-primary-nav a:visible')).to_have_count(6)
        expect(page.locator('.hub-context-nav button:visible')).to_have_count(1)
        assert page.evaluate('originalIds.every(id => document.querySelectorAll(`#${id}`).length === 1)')
        expect(page.locator('.hub-connection-summary')).to_contain_text('Lighting: Connected')
        page.evaluate("document.getElementById('mqttState').textContent='Offline'")
        expect(page.locator('.hub-connection-summary')).to_contain_text('Lighting: Offline')
        print('PASS: six areas, stable IDs, live status retained')
        page.locator('.hub-group', has_text='Plan').click()
        expect(page.locator('.hub-context-nav button:visible')).to_have_count(2)
        page.locator('.hub-context-nav button[data-page="schedules"]').click()
        expect(page).to_have_url(base + '/controller/#/schedules')
        page.go_back()
        expect(page.locator('#classes')).to_have_class('page active')
        page.go_back()
        expect(page.locator('#overview')).to_have_class('page active')
        print('PASS: navigation and browser back')
        page.keyboard.press('Control+k')
        expect(page.locator('.hub-command-dialog')).to_be_visible()
        page.get_by_role('searchbox').fill('lights')
        expect(page.locator('.hub-command-result')).to_have_count(1)
        page.keyboard.press('ArrowDown')
        expect(page.locator('.hub-command-result')).to_be_focused()
        page.keyboard.press('Enter')
        expect(page.locator('#lights')).to_have_class('page active')
        expect(page.locator('#lights h1')).to_be_focused()
        page.locator('.hub-search-trigger').click()
        page.keyboard.press('Escape')
        expect(page.locator('.hub-search-trigger')).to_be_focused()
        print('PASS: search, keyboard navigation, Escape and focus')
        page.locator('.hub-group', has_text='Today').click()
        page.locator('.hub-task', has_text='Start a timer').click()
        frame = page.frame_locator('#display iframe')
        expect(frame.locator('#timer')).to_have_class('workspace active')
        expect(frame.locator('html')).to_have_class('hub-ui')
        expect(frame.locator('.hub-editor-heading')).to_contain_text('Prepare')
        expect(frame.locator('.hub-target-context')).to_contain_text('Front screen')
        expect(frame.locator('.previewPanel')).not_to_be_visible()
        frame.locator('.hub-fold > summary', has_text='Live preview').click()
        expect(frame.locator('.previewPanel')).to_be_visible()
        assert page.evaluate('hardwareActions.length') == 0
        print('PASS: timer shortcut, preserved screen context, collapsed preview, no hardware commands')
        page.goto(base + '/controller/#/display/timer')
        ready()
        expect(page.frame_locator('#display iframe').locator('#timer')).to_have_class('workspace active')
        page.goto(base + '/controller/')
        ready()
        page.locator('.hub-group', has_text='Admin').click()
        page.locator('#fixture-settings').fill('Retained edit')
        page.locator('#fixture-settings').dispatch_event('change')
        assert page.evaluate('window.originalListenerFired')
        assert page.locator('#fixture-settings').input_value() == 'Retained edit'
        page.evaluate("for (const id of ['settings','diagnostics','system']) { document.getElementById(id).dataset.authorized='false';document.querySelector(`nav button[data-page=${id}]`).hidden=true; } showPage('overview');")
        expect(page.locator('.hub-group', has_text='Admin')).not_to_be_visible()
        page.locator('.hub-search-trigger').click()
        page.get_by_role('searchbox').fill('backups')
        expect(page.locator('.hub-command-result')).to_have_count(0)
        page.evaluate("AUTH_STATUS.user=null;document.getElementById('authAccount').style.display='none'")
        expect(page.locator('.hub-command-dialog')).not_to_be_visible()
        expect(page.locator('.hub-search-trigger')).to_be_disabled()
        print('PASS: deep links, preserved form listeners, permissions and logout')
        page.goto(base + '/controller/?workspace=classic')
        expect(page.locator('.hub-workspace-bar')).to_have_count(0)
        assert not page.evaluate("document.documentElement.classList.contains('hub-ui')")
        page.goto(base + '/controller/')
        ready()
        page.locator('.hub-density').click()
        expect(page.locator('html')).to_have_attribute('data-hub-density', 'compact')
        page.reload()
        ready()
        expect(page.locator('html')).to_have_attribute('data-hub-density', 'compact')
        page.locator('.hub-density').click()
        page.screenshot(path=str(ROOT / 'workspace-desktop-preview.png'), full_page=True)
        page.set_viewport_size({'width': 390, 'height': 844})
        expect(page.locator('.hub-primary-nav')).not_to_be_visible()
        page.locator('.hub-mobile-menu').click()
        expect(page.locator('.hub-primary-nav')).to_be_visible()
        page.keyboard.press('Escape')
        expect(page.locator('.hub-primary-nav')).not_to_be_visible()
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'Mobile overflow'
        page.screenshot(path=str(ROOT / 'workspace-mobile-preview.png'), full_page=True)
        print('PASS: classic escape hatch, density preference and mobile navigation')
        assert not errors, errors
        browser.close()
        print('Workspace browser smoke checks passed. Hardware and API behavior were mocked.')

if __name__ == '__main__':
    main()
