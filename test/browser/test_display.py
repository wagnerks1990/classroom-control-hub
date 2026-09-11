"""Browser layout regression tests against the real receiver HTML and scripts.

Only the WebSocket transport, branding API, and unrelated audio SDK are mocked.
No layout function, measurement, stylesheet or DOM component is mocked.
Run: python -m unittest discover -s test/browser -v
"""
import base64
import copy
import json
import os
from pathlib import Path
import re
import unittest
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / 'test-results' / 'display'
VERSION = re.search(r"DISPLAY_BUILD='([^']+)'", (ROOT/'public/display/index.html').read_text())[1]
NOW = 1788970000000
P7 = {
    'background': {'color': '#000000'},
    'title': 'Period 7 - Classroom Announcement',
    'titleOptions': {'size': 72, 'color': '#ffffff'},
    'subtitle': 'Remember to Behave and Place Cellphone in Locker before Bell',
    'subtitleOptions': {'size': 40, 'color': '#ffffff'},
    'text': 'Classroom Update\n\nUnit 1 - Course Models, Architecture, and Core Concepts\n\nSelect today\'s assignment(s) - 01/15/2030\n\nDO NOW - LESSON - LEARN - DISCUSSION - ASSIGNMENT - CHECK UNDERSTANDING',
    'textOptions': {'size': 54, 'color': '#ffffff', 'position': 'center'},
    'timer': {'visible': True, 'running': False, 'mode': 'countdown', 'remainingSeconds': 0,
              'durationSeconds': 3600, 'fontSize': 75, 'position': 'bottom',
              'label': 'Period 7 • Class Ends In', 'timerInstanceId': 'fixture-p7'},
}
P6 = copy.deepcopy(P7)
P6.update(title='Period 6 - Classroom Instructions', subtitle='Classroom Instructor',
          text='01/15/2030\n\nDO NOW - LEARN - MODULES - EXIT TICKET')
P6['timer'].update(label='Period 6 • Class Ends In', timerInstanceId='fixture-p6')
CLUB_SELECTION = {
    'background': {'color': '#000000'},
    'title': 'Please log in to Schoology during HOMEROOM\nand complete your Club Selection',
    'titleOptions': {'size': 72, 'color': '#ffffff'},
    'subtitle': '10th, 11th & 12th Grade Students',
    'subtitleOptions': {'size': 40, 'color': '#ffffff'},
    'text': ('Select a 1st Choice\nSelect a 2nd Choice\nSelect a 3rd Choice\n'
             'Make sure all three choices are different\n\n'
             'Choosing three different clubs gives you a better chance of\n'
             'being placed in a club you selected.'),
    'textOptions': {'size': 54, 'color': '#ffffff', 'position': 'center'},
    'timer': {'visible': True, 'running': False, 'mode': 'countdown',
              'remainingSeconds': 295, 'durationSeconds': 300, 'fontSize': 75,
              'position': 'bottom', 'label': 'B2 - P8 • Class Ends In',
              'timerInstanceId': 'fixture-club-selection'},
}

TRANSPORT = """(() => {
  window.__now = 1788970000000;
  Date.now = () => window.__now;
  window.__sent = [];
  window.WebSocket = class {
    constructor() { this.readyState=1; window.__receiverSocket=this; setTimeout(()=>this.onopen?.(),0); }
    send(data) { window.__sent.push(JSON.parse(data)); }
    close() { this.readyState=3; this.onclose?.(); }
  };
})()"""
MEASURE = """() => {
 const stage=document.getElementById('stage'), sr=stage.getBoundingClientRect();
 const scale=Number(stage.dataset.scale);
 const rect=el=>{const r=el.getBoundingClientRect();return {x:(r.x-sr.x)/scale,y:(r.y-sr.y)/scale,w:r.width/scale,h:r.height/scale}};
 const result={diagnostics:window.ClassroomDisplayDiagnostics(), stage:{x:sr.x,y:sr.y,w:sr.width,h:sr.height}, parts:{}, ranges:[]};
 for(const [name,child,parent] of [['title','title','titleRegion'],['subtitle','subtitle','subtitleRegion'],['body','text','textLayer'],['timer','timerOverlay','timerRegion']]) {
  const el=document.getElementById(child), box=document.getElementById(parent);
  if(!el.textContent.trim() || getComputedStyle(box).display==='none')continue;
  result.parts[name]={font:parseFloat(getComputedStyle(el).fontSize), child:rect(el), box:rect(box), logicalBox:{x:box.offsetLeft,y:box.offsetTop,w:box.clientWidth,h:box.clientHeight}, text:el.textContent, scrollW:el.scrollWidth,clientW:el.clientWidth};
  const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);
  while(walker.nextNode()) {
   if(!walker.currentNode.textContent.trim())continue;
   const range=document.createRange();range.selectNodeContents(walker.currentNode);
   for(const r of range.getClientRects())if(r.width>0)result.ranges.push({name,x:(r.x-sr.x)/scale,y:(r.y-sr.y)/scale,w:r.width/scale,h:r.height/scale});
  }
 }
 return result;
}"""

class DisplayBrowserTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        OUTPUT.mkdir(parents=True, exist_ok=True)
        cls.pw = sync_playwright().start()
        cls.engine = os.getenv('DISPLAY_TEST_BROWSER', 'chromium')
        launch = {'headless': True}
        if os.getenv('DISPLAY_TEST_EXECUTABLE'):
            launch['executable_path'] = os.environ['DISPLAY_TEST_EXECUTABLE']
        cls.browser = getattr(cls.pw, cls.engine).launch(**launch)
        cls.measurements = []

    @classmethod
    def tearDownClass(cls):
        (OUTPUT/f'{cls.engine}-measurements.json').write_text(json.dumps(cls.measurements, indent=2))
        cls.browser.close()
        cls.pw.stop()

    def page(self, width=1920, height=1080, dpr=1, layout_css=True):
        context = self.browser.new_context(viewport={'width': width, 'height': height}, device_scale_factor=dpr)
        self.addCleanup(context.close)
        page = context.new_page()
        self.errors = []
        page.on('pageerror', lambda err: self.errors.append(str(err)))
        page.add_init_script(TRANSPORT)
        def route(req):
            path = urlparse(req.request.url).path
            if path == '/api/v1/branding':
                return req.fulfill(json={'branding': {}})
            if path == '/display/sendspin.bundle.js':
                return req.fulfill(content_type='text/javascript', body='export class SendspinPlayer {}')
            if path == '/display/layout.css' and not layout_css:
                return req.fulfill(content_type='text/css', body='')
            if path in ['/display/tv7', '/display/tv1', '/display/']:
                path = '/display/index.html'
            file = ROOT/'public'/path.lstrip('/')
            if not file.is_file():
                return req.fulfill(status=404, body='not found')
            mime = {'.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.html':'text/html','.ttf':'font/ttf'}.get(file.suffix,'text/plain')
            return req.fulfill(content_type=mime, body=file.read_bytes())
        page.route('**/*', route)
        self.open_renderer(page)
        page.wait_for_function("window.__receiverSocket && window.ClassroomDisplayDiagnostics && document.getElementById('stage').dataset.fontStatus !== 'loading'")
        self.assertFalse(self.errors)
        return page

    def open_renderer(self, page):
        if not os.getenv('DISPLAY_TEST_INLINE'):
            page.goto('http://127.0.0.1:31337/display/tv7')
            return
        # Restricted local test environments may disallow all URL navigation.
        # Inline identical source/CSS/font bytes without changing browser policy.
        # CI always exercises the unmodified URL/asset-loading path above.
        page.evaluate(TRANSPORT)
        html=(ROOT/'public/display/index.html').read_text()
        css=(ROOT/'public/display/layout.css').read_text()
        for name in ['LiberationSans-Regular.ttf','LiberationSans-Bold.ttf']:
            encoded=base64.b64encode((ROOT/'public/display/fonts'/name).read_bytes()).decode()
            css=css.replace('/display/fonts/'+name,'data:font/ttf;base64,'+encoded)
        html=re.sub(r'<link rel="stylesheet" href="/display/layout.css[^"]*">',lambda _: '<style>'+css+'</style>',html)
        html=re.sub(r'<link rel="stylesheet" href="/shared/attribution.css">','',html)
        loc="{pathname:'/display/tv7',protocol:'http:',host:'127.0.0.1:31337',origin:'http://127.0.0.1:31337',search:'',hash:'',href:'http://127.0.0.1:31337/display/tv7'}"
        def shared(match):
            name=match[1]
            source=(ROOT/'public/shared'/name).read_text()
            return '<script>(function(location){'+source+'})('+loc+');</script>'
        html=re.sub(r'<script src="/shared/(branding.js|attribution.js)[^"]*" defer></script>',shared,html)
        module=(ROOT/'public/display/layout.mjs').read_text().replace('export ','')
        common=(ROOT/'public/shared/common.js').read_text().replace('export ','')
        security=(ROOT/'public/display/security.mjs').read_text().replace('export ','')
        html=re.sub(r'^import .*?;?$', '', html, flags=re.M)
        html=html.replace('<script type="module">', '<script type="module">const location='+loc+';'+module+common+security+';class SendspinPlayer {}')
        page.set_content(html,wait_until='load')

    def reload_renderer(self, page):
        if os.getenv('DISPLAY_TEST_INLINE'): self.open_renderer(page)
        else: page.reload()

    def settle(self, page):
        page.evaluate('() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')

    def replay(self, page, state):
        page.evaluate('(m)=>window.__receiverSocket.onmessage({data:JSON.stringify(m)})',
                      {'type': 'hello.ack', 'version': VERSION, 'state': state})
        self.settle(page)

    def command(self, page, kind, payload):
        page.evaluate('(m)=>window.__receiverSocket.onmessage({data:JSON.stringify(m)})',
                      {'type': 'command', 'command': {'type': kind, 'payload': payload}})
        self.settle(page)

    def measure(self, page, label, expected_font_status='ready'):
        data = page.evaluate(MEASURE)
        self.measurements.append({'label':label, **data})
        page.screenshot(path=str(OUTPUT/f'{self.engine}-{label}.png'))
        self.assertEqual(data['diagnostics']['fontStatus'], expected_font_status)
        self.assertFalse(self.errors, self.errors)
        self.assertEqual(page.locator('script[data-controlhub-display-autofit]').count(), 0)
        for name, item in data['parts'].items():
            self.contained(item['child'], item['box'], name)
            self.assertLessEqual(item['scrollW'], item['clientW'] + 1, name)
        for item in data['ranges']:
            self.contained(item, data['parts'][item['name']]['box'], f"{item['name']} glyphs")
        parts = list(data['parts'].items())
        for i, (name, item) in enumerate(parts):
            for other, other_item in parts[i+1:]:
                a,b=item['box'],other_item['box']
                overlap = min(a['y']+a['h'],b['y']+b['h'])-max(a['y'],b['y'])
                self.assertLessEqual(overlap, 0.75, f'{name} overlaps {other}')
        return data

    def contained(self, child, box, label):
        for dimension, size in [('x','w'),('y','h')]:
            self.assertGreaterEqual(child[dimension], box[dimension]-1, label)
            self.assertLessEqual(child[dimension]+child[size], box[dimension]+box[size]+1, label)

    def signature(self, data):
        # Compare untransformed DOM geometry, not round-tripped paint coordinates.
        # Firefox quantizes transformed rects; containment still checks those rects.
        return {name:(round(p['font'],2),*[p['logicalBox'][d] for d in ['x','y','w','h']]) for name,p in data['parts'].items()}

    def test_01_p6_p7_cross_resolution_and_reload(self):
        baseline={}
        for w,h,dpr in [(1920,1080,1),(3840,2160,1),(1920,1080,2),(1280,720,1),(1082,1226,1)]:
            page=self.page(w,h,dpr)
            for name,state in [('p6',P6),('p7',P7)]:
                self.replay(page,state)
                data=self.measure(page,f'{name}-{w}x{h}-dpr{dpr}')
                self.assertGreater(data['parts']['body']['font'], 54 if name=='p6' else 30)
                if name in baseline:self.assertEqual(self.signature(data),baseline[name])
                else:baseline[name]=self.signature(data)
                self.reload_renderer(page);page.wait_for_function('window.__receiverSocket && window.ClassroomDisplayDiagnostics')
                self.replay(page,state)
                page.wait_for_function("document.getElementById('stage').dataset.fontStatus==='ready'")
                self.settle(page)
                self.assertEqual(self.signature(page.evaluate(MEASURE)),baseline[name])

    def test_02_live_commands_equal_replay_and_preserve_colors(self):
        page=self.page()
        state=copy.deepcopy(P7)
        state['titleOptions']['color']='#ffcc00';state['subtitleOptions']['color']='#00ddff'
        self.command(page,'display.clear',{})
        self.command(page,'display.title',{'text':state['title'],**state['titleOptions']})
        self.command(page,'display.subtitle',{'text':state['subtitle'],**state['subtitleOptions']})
        self.command(page,'display.text',{'text':state['text'],**state['textOptions']})
        self.command(page,'display.timer',state['timer'])
        live=self.measure(page,'live-commands')
        self.replay(page,state)
        self.assertEqual(self.signature(page.evaluate(MEASURE)),self.signature(live))
        self.assertEqual(page.locator('#title').evaluate('(el)=>getComputedStyle(el).color'),'rgb(255, 204, 0)')
        self.assertEqual(page.locator('#subtitle').evaluate('(el)=>getComputedStyle(el).color'),'rgb(0, 221, 255)')

    def test_03_timer_ticks_hour_boundary_expiry_no_global_layout(self):
        page=self.page()
        state=copy.deepcopy(P7)
        state['timer'].update(running=True,endAt=NOW+3601000)
        self.replay(page,state)
        before=self.measure(page,'timer-start')
        count=before['diagnostics']['passCount']
        for advance in [2000,3599000,3602000]:
            page.evaluate('(now)=>window.__now=now',NOW+advance)
            page.wait_for_timeout(1100)
            data=self.measure(page,f'timer-{advance}')
            self.assertEqual(self.signature(data),self.signature(before))
            self.assertEqual(data['diagnostics']['passCount'],count)
        self.assertEqual(page.locator('#timerValue').inner_text(),'00:00')
        page.evaluate("window.__receiverSocket.onmessage({data:JSON.stringify({type:'heartbeat.ack'})})")
        self.settle(page)
        self.assertEqual(page.evaluate('window.ClassroomDisplayDiagnostics().passCount'),count)

    def test_04_timer_positions_hide_show_and_label(self):
        page=self.page()
        for position in ['bottom','top','center']:
            state=copy.deepcopy(P7);state['timer']['position']=position
            state['timer']['label']='Class Ends In '+('long label '*25)
            state['timer']['borderWidth']=24
            self.replay(page,state)
            self.measure(page,'timer-position-'+position)
        self.command(page,'display.timer.hide',{})
        hidden=self.measure(page,'timer-hidden')
        self.assertNotIn('timer',hidden['parts'])
        self.command(page,'display.timer',P7['timer'])
        self.measure(page,'timer-reshown')

    def test_05_long_content_manual_size_and_empty(self):
        page=self.page()
        state=copy.deepcopy(P7)
        state['text']='\n'.join(['A long network troubleshooting instruction. '*4]*30)
        state['title']='Long heading '*30;state['subtitle']='Long subtitle '*35
        self.replay(page,state)
        data=self.measure(page,'long-content')
        self.assertLess(data['parts']['body']['font'],54)
        state=copy.deepcopy(P6);state['textOptions'].update(autoFit=False,size=54)
        self.replay(page,state)
        data=self.measure(page,'manual-54')
        self.assertEqual(data['parts']['body']['font'],54)
        self.command(page,'display.clear',{})
        data=self.measure(page,'empty')
        self.assertEqual(data['parts'],{})

    def test_06_resize_only_scales_and_reconnect(self):
        page=self.page()
        self.replay(page,P7)
        before=self.measure(page,'before-resize')
        for w,h in [(1082,1226),(3840,2160),(1920,1080)]:
            page.set_viewport_size({'width':w,'height':h});self.settle(page)
            data=self.measure(page,f'resized-{w}x{h}')
            self.assertEqual(self.signature(data),self.signature(before))
            self.assertEqual(data['diagnostics']['passCount'],before['diagnostics']['passCount'])
        page.evaluate('window.__receiverSocket.close()');page.wait_for_timeout(1600)
        self.replay(page,P7)
        self.assertEqual(self.signature(page.evaluate(MEASURE)),self.signature(before))

    def test_07_padding_regression_and_unbroken_words(self):
        page=self.page();self.replay(page,P7)
        old_failure=page.locator('#text').evaluate("""el=>{
          const box=el.parentElement,s=getComputedStyle(el);
          return el.scrollWidth > box.clientWidth-parseFloat(s.paddingLeft)-parseFloat(s.paddingRight)+1;
        }""")
        self.assertTrue(old_failure, 'fixture must exercise the original double-padding bug')
        self.measure(page,'padding-regression')
        state=copy.deepcopy(P7);state['text']='X'*1000
        self.replay(page,state);self.measure(page,'unbroken-word')

    def test_08_below_minimum_containment_and_timer_range(self):
        page=self.page();state=copy.deepcopy(P7)
        state['text']='\n'.join(['Dense content']*900)
        self.replay(page,state)
        data=self.measure(page,'below-readable-minimum')
        self.assertEqual(data['diagnostics']['components']['body']['status'],'below-readable-minimum')
        for total in [3600,3600000,9007199254740991]:
            state=copy.deepcopy(P6)
            state['timer'].update(remainingSeconds=total,durationSeconds=total,label='',autoFit=False,fontSize=400)
            self.replay(page,state);self.measure(page,'timer-wide-'+str(total))

    def test_09_timer_style_only_and_body_alignment(self):
        page=self.page();self.replay(page,P7)
        for position in ['top','bottom','center']:
            self.command(page,'display.text',{'text':P6['text'],'position':position,'size':54})
            self.measure(page,'body-alignment-'+position)
        self.command(page,'display.timer',{'fontSize':30,'autoFit':False})
        data=self.measure(page,'timer-style-only')
        self.assertEqual(data['parts']['timer']['font'],30)
        self.command(page,'display.timer',{'fontSize':75,'autoFit':True})
        self.measure(page,'timer-auto-restored')

    def test_10_club_selection_survives_missing_layout_stylesheet(self):
        page=self.page(layout_css=False)
        self.replay(page,CLUB_SELECTION)
        data=self.measure(page,'club-selection-no-layout-css')
        self.assertGreater(data['parts']['title']['font'],20)
        self.assertGreater(data['parts']['body']['font'],20)

    def test_11_media_url_policy_and_external_frame_isolation(self):
        page=self.page();self.replay(page,P6)
        before=page.evaluate(MEASURE)
        for value in ['javascript:window.__xss=1', 'data:text/html,<script>parent.__xss=1</script>',
                      'file:///etc/passwd', 'https://user:pass@signage.example/page',
                      '/document-viewer/?file=javascript%3Aalert(1)']:
            self.command(page,'display.web',{'url':value})
            self.assertEqual(page.locator('#media iframe').count(),0)
            self.assertIn('rejected invalid media URL',page.locator('#badge').inner_text())
        self.assertIsNone(page.evaluate('window.__xss'))
        page.route('https://signage.example/**',lambda route: route.fulfill(content_type='text/html',body='<h1>External signage fixture</h1>'))
        self.command(page,'display.web',{'url':'https://signage.example/page'})
        frame=page.locator('#media iframe')
        self.assertEqual(frame.get_attribute('src'),'https://signage.example/page')
        sandbox=frame.get_attribute('sandbox').split()
        self.assertIn('allow-scripts',sandbox)
        self.assertNotIn('allow-same-origin',sandbox)
        self.assertNotIn('allow-top-navigation',sandbox)
        self.command(page,'display.web',{'url':'javascript:alert(1)'})
        self.assertEqual(frame.get_attribute('src'),'https://signage.example/page')
        self.assertEqual(self.signature(page.evaluate(MEASURE)),self.signature(before))
        self.command(page,'display.clear',{})
        self.assertEqual(page.locator('#media iframe').count(),0)
        self.assertFalse(self.errors)

    def test_12_reject_audio_socket_destination_without_opening_socket(self):
        page=self.page();self.replay(page,P6)
        page.evaluate('window.__originalReceiver=window.__receiverSocket')
        for url in ['wss://attacker.example/music-assistant/sendspin-proxy?ticket='+'a'*32,
                    '/ws?ticket='+'a'*32, '/music-assistant/sendspin-proxy?ticket=invalid']:
            self.command(page,'music.assistant.attach',{'proxyUrl':url})
            self.assertTrue(page.evaluate('window.__receiverSocket===window.__originalReceiver'))
            self.assertEqual(page.evaluate('window.__sent.filter(x=>x.type==="music.assistant.status").at(-1).status.state'),'error')
        self.assertFalse(self.errors)

    def test_13_identify_timeout_is_bounded_and_replaced(self):
        page=self.page();self.replay(page,P6)
        page.evaluate("""() => {
          window.__delays=[];window.__cancelled=[];
          const set=window.setTimeout,clear=window.clearTimeout;
          window.setTimeout=(fn,delay,...args)=>{const id=set(fn,delay,...args);window.__delays.push({id,delay});return id};
          window.clearTimeout=id=>{window.__cancelled.push(id);return clear(id)};
        }""")
        self.command(page,'display.identify',{'durationMs':9007199254740991})
        first=page.evaluate('window.__delays.find(x=>x.delay===30000)')
        self.assertIsNotNone(first)
        self.command(page,'display.identify',{'durationMs':-1})
        self.assertIn(first['id'],page.evaluate('window.__cancelled'))
        self.assertEqual(page.locator('#identify').evaluate('el=>el.style.display'),'flex')
        page.wait_for_timeout(1150)
        self.assertEqual(page.locator('#identify').evaluate('el=>el.style.display'),'none')
        self.command(page,'display.identify',{'durationMs':30000})
        self.command(page,'display.clear',{})
        self.assertEqual(page.locator('#identify').evaluate('el=>el.style.display'),'none')
        self.assertFalse(self.errors)

if __name__ == '__main__':
    unittest.main(verbosity=2)
