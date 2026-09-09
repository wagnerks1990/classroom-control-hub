"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const http=require("node:http");
const {once}=require("node:events");
const {WebSocket,WebSocketServer}=require("ws");
const {relaySendspin}=require("../src/music-assistant-sendspin");

async function start(t) {
  let apiRequests=0;
  const api=http.createServer((_req,res)=>{apiRequests++;res.writeHead(500);res.end();});
  api.on("upgrade",(_req,socket)=>{apiRequests++;socket.destroy();});
  api.listen(0,"127.0.0.1"); await once(api,"listening");
  const dedicated=new WebSocketServer({host:"127.0.0.1",port:0,path:"/sendspin"});
  await once(dedicated,"listening");
  const hub=new WebSocketServer({host:"127.0.0.1",port:0,path:"/music-assistant/sendspin-proxy"});
  await once(hub,"listening");
  const errors=[],paths=[],frames=[];
  dedicated.on("connection",(socket,req)=>{
    paths.push(req.url);
    socket.send('{"type":"server/hello","payload":{"name":"fixture"}}');
    socket.send(Buffer.from([255,0,1,2]));
    socket.on("message",(data,isBinary)=>{frames.push({text:data.toString(),binary:isBinary});socket.send(data,{binary:isBinary});});
  });
  hub.on("connection",client=>relaySendspin(client,{WebSocket,config:{
    url:`http://127.0.0.1:${api.address().port}/api`,sendspinHost:"127.0.0.1",sendspinPort:dedicated.address().port
  },onError:error=>errors.push(error)}));
  const clients=[];
  t.after(async()=>{
    for(const client of clients)if(client.readyState!==WebSocket.CLOSED)client.terminate();
    for(const server of [hub,dedicated])for(const client of server.clients)client.terminate();
    await Promise.all([new Promise(resolve=>hub.close(resolve)),new Promise(resolve=>dedicated.close(resolve)),new Promise(resolve=>api.close(resolve))]);
  });
  return {hub,dedicated,frames,paths,errors,apiRequests:()=>apiRequests,connect(){
    const ws=new WebSocket(`ws://127.0.0.1:${hub.address().port}/music-assistant/sendspin-proxy`);clients.push(ws);return ws;
  }};
}

async function until(predicate) {
  for(let i=0;i<100;i++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,10));}
  assert.ok(predicate(),"fixture did not reach the expected state");
}

test("real WebSockets relay initial protocol and binary frames through dedicated port without API auth",{timeout:10000},async t=>{
  const f=await start(t),client=f.connect(),received=[];
  client.on("message",(data,isBinary)=>received.push({data,binary:isBinary}));
  await once(client,"open");
  const hello='{"type":"client/hello","payload":{"client_id":"classroom-hub-tv1"}}';
  client.send(hello);client.send(Buffer.from([0,255,4,5]));
  await until(()=>received.length===4);
  assert.equal(received[0].data.toString(),'{"type":"server/hello","payload":{"name":"fixture"}}');
  assert.equal(received[0].binary,false);
  assert.deepEqual(received[1].data,Buffer.from([255,0,1,2]));assert.equal(received[1].binary,true);
  assert.equal(received[2].data.toString(),hello);
  assert.deepEqual(received[3].data,Buffer.from([0,255,4,5]));assert.equal(received[3].binary,true);
  assert.deepEqual(f.paths,["/sendspin"]);
  assert.equal(f.frames[0].text,hello);assert.equal(f.frames.length,2);
  assert.equal(f.apiRequests(),0);assert.deepEqual(f.errors,[]);
  const closed=once(client,"close");client.close();await closed;
  await until(()=>f.dedicated.clients.size===0);
});

test("real close/reconnect cycles do not leave old upstream sessions running",{timeout:10000},async t=>{
  const f=await start(t);
  for(let i=0;i<3;i++){
    const client=f.connect();await once(client,"open");
    await until(()=>f.dedicated.clients.size===1);
    const closed=once(client,"close");client.close();await closed;
    await until(()=>f.dedicated.clients.size===0&&f.hub.clients.size===0);
  }
  assert.equal(f.paths.length,3);assert.equal(f.apiRequests(),0);assert.deepEqual(f.errors,[]);
});
