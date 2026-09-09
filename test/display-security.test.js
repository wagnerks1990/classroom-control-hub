'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const policy=import('../public/display/security.mjs');
const origin='https://hub.example:8443';
const ticket='a'.repeat(32);

test('media URLs allow signage HTTP(S) but reject executable schemes, credentials and malformed input',async()=>{
  const {authorizeMediaUrl}=await policy;
  for(const value of ['javascript:alert(1)','JaVaScRiPt:alert(1)','data:text/html,<script>alert(1)</script>','blob:https://hub.example/id','file:///etc/passwd','ftp://host/file','https://user:pass@host/image','https://bad\\host/file','java\nscript:alert(1)','',null,{},'x'.repeat(8193)]){
    assert.throws(()=>authorizeMediaUrl(value,origin),String(value));
  }
  assert.equal(authorizeMediaUrl('/image.png',origin),origin+'/image.png');
  assert.equal(authorizeMediaUrl('https://signage.example/page',origin),'https://signage.example/page');
  assert.equal(authorizeMediaUrl('http://192.0.2.10:5080/LiveApp/play.html?id=classroom',origin),'http://192.0.2.10:5080/LiveApp/play.html?id=classroom');
});

test('asset tokens stay on protected same-origin paths; nested viewers fail closed',async()=>{
  const {authorizeMediaUrl}=await policy;
  assert.equal(new URL(authorizeMediaUrl('/media/lesson.pdf',origin,'test-token')).searchParams.get('access_token'),'test-token');
  assert.equal(new URL(authorizeMediaUrl('https://signage.example/media/image.png',origin,'test-token')).searchParams.has('access_token'),false);
  const viewer=new URL(authorizeMediaUrl('/document-viewer/?file=%2Fmedia%2Flesson.pdf',origin,'test-token'));
  assert.equal(new URL(viewer.searchParams.get('file')).searchParams.get('access_token'),'test-token');
  assert.throws(()=>authorizeMediaUrl('/document-viewer/?file=javascript%3Aalert(1)',origin,'test-token'));
  let recursive='/media/test.pdf';for(let i=0;i<6;i++)recursive='/document-viewer/?file='+encodeURIComponent(recursive);
  assert.throws(()=>authorizeMediaUrl(recursive,origin));
});

test('Sendspin uses only the fixed same-Hub proxy with one valid ticket',async()=>{
  const {musicAssistantProxyUrl}=await policy;
  const path='/music-assistant/sendspin-proxy?ticket='+ticket;
  assert.equal(musicAssistantProxyUrl(path,origin),'wss://hub.example:8443'+path);
  assert.equal(musicAssistantProxyUrl('wss://hub.example:8443'+path,origin),'wss://hub.example:8443'+path);
  assert.equal(musicAssistantProxyUrl(path,'http://hub.example:3000'),'ws://hub.example:3000'+path);
  for(const value of ['wss://attacker.example'+path,'//attacker.example'+path,'ws://hub.example:8443'+path,'wss://hub.example'+path,'/ws?ticket='+ticket,path+'&ticket='+ticket,path+'&host=attacker.example',path+'#fragment',path.replace(ticket,'invalid'),'/music-assistant/sendspin-proxy/../admin?ticket='+ticket,'wss://user:pass@hub.example:8443'+path]){
    assert.throws(()=>musicAssistantProxyUrl(value,origin),value);
  }
});

test('identify durations are finite and bounded from one to thirty seconds',async()=>{
  const {identifyDuration}=await policy;
  for(const value of [undefined,null,'',NaN,Infinity,-Infinity,'garbage'])assert.equal(identifyDuration(value),8000);
  for(const value of [-100,0,1,999])assert.equal(identifyDuration(value),1000);
  assert.equal(identifyDuration('2500'),2500);
  assert.equal(identifyDuration(2500.75),2500);
  for(const value of [30000,60000,Number.MAX_SAFE_INTEGER])assert.equal(identifyDuration(value),30000);
});
