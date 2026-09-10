#!/usr/bin/env python3
import hmac, json, os, re, shutil, socketserver, subprocess, threading, urllib.parse
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from datetime import datetime, timezone

VERSION = "1.0.0-alpha.73"
SOCKET_PATH = os.environ.get("CLASSROOM_HUB_HOST_AGENT_SOCKET", "/run/classroom-control-hub/host-agent.sock")
TOKEN = os.environ.get("MAINTENANCE_TOKEN", "")

SERVICE_POLICY = {
    "docker.service":{"owner":"core","recommendation":"keep","purpose":"Container runtime for Classroom Control Hub and managed integrations","protected":True},
    "containerd.service":{"owner":"core","recommendation":"keep","purpose":"Docker container runtime dependency","protected":True},
    "cloudflared.service":{"owner":"integration","recommendation":"integrate","purpose":"Remote access / Cloudflare Tunnel"},
    "veyon.service":{"owner":"integration","recommendation":"integrate","purpose":"Classroom workstation management"},
    "veyon-webapi.service":{"owner":"integration","recommendation":"integrate","purpose":"Veyon control API used by Classroom Control Hub"},
    "ollama.service":{"owner":"integration","recommendation":"integrate","purpose":"Local AI runtime"},
    "tailscaled.service":{"owner":"optional","recommendation":"optional-keep","purpose":"Optional remote/VPN management"},
    "ssh.service":{"owner":"host","recommendation":"keep","purpose":"Emergency administrative access","protected":True},
    "systemd-networkd.service":{"owner":"host","recommendation":"keep","purpose":"Host networking","protected":True},
    "systemd-resolved.service":{"owner":"host","recommendation":"keep","purpose":"Host DNS resolver","protected":True},
    "chrony.service":{"owner":"host","recommendation":"keep","purpose":"Time synchronization","protected":True},
    "smartmontools.service":{"owner":"host","recommendation":"keep","purpose":"Disk health monitoring"},
    "unattended-upgrades.service":{"owner":"host","recommendation":"keep","purpose":"Ubuntu security updates"},
    "classroom-control-hub-host-agent.service":{"owner":"core","recommendation":"keep","purpose":"Native host-management bridge for Classroom Control Hub","protected":True},
    "classroom-hub-update.service":{"owner":"core","recommendation":"keep","purpose":"Native package update runner (idle except during explicit updates)","protected":True},
    "classroom-hub-app-update.service":{"owner":"core","recommendation":"keep","purpose":"Verified application release and rollback runner","protected":True},
}
UNIT_RE = re.compile(r"^[A-Za-z0-9_.@:-]+\.(?:service|socket|timer|target)$")

def run(args, timeout=20, check=True):
    p = subprocess.run(args, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout)
    if check and p.returncode != 0:
        raise RuntimeError((p.stderr or p.stdout or f"command failed ({p.returncode})").strip())
    return p

def unit_state(name):
    a = run(["systemctl","is-active",name], 8, False)
    e = run(["systemctl","is-enabled",name], 8, False)
    d = run(["systemctl","show",name,"--property=Description","--value"], 8, False)
    return {
        "active": (a.stdout.strip() or "inactive"),
        "enabled": (e.stdout.strip() or "disabled"),
        "description": d.stdout.strip(),
    }

def list_services():
    p = run(["systemctl","list-unit-files","--type=service","--no-legend","--no-pager"], 25)
    names = []
    for line in p.stdout.splitlines():
        parts=line.strip().split()
        if parts and parts[0].endswith(".service"): names.append(parts[0])
    names = sorted(set(names))
    interesting=set(SERVICE_POLICY)
    for n in names:
        if re.match(r"^(cloudflared|veyon|ollama|tailscale|docker|containerd|mosquitto|classroom)",n,re.I): interesting.add(n)
    items=[]
    for name in sorted(interesting):
        if name not in names and name not in SERVICE_POLICY: continue
        st=unit_state(name)
        pol=SERVICE_POLICY.get(name,{"owner":"unmanaged","recommendation":"review","purpose":st.get("description") or "Host service not yet classified"})
        items.append({"name":name,**st,**pol})
    return items

def meminfo():
    vals={}
    try:
        for line in Path('/proc/meminfo').read_text().splitlines():
            k,v=line.split(':',1); vals[k]=int(v.strip().split()[0])*1024
    except Exception: pass
    return {"totalBytes":vals.get("MemTotal"),"availableBytes":vals.get("MemAvailable")}

def cpu_temperature():
    temps=[]
    base=Path('/sys/class/thermal')
    if base.exists():
        for f in base.glob('thermal_zone*/temp'):
            try:
                v=float(f.read_text().strip());
                if v>1000: v/=1000.0
                if 0 < v < 150: temps.append(v)
            except Exception: pass
    return {"celsius": max(temps) if temps else None, "zones": len(temps)}

def smart_summary():
    if not shutil.which('smartctl'): return {"available":False,"healthy":None,"devices":[]}
    devices=[]
    try:
        scan=run(['smartctl','--scan-open'],15,False)
        for line in scan.stdout.splitlines()[:16]:
            dev=line.split()[0] if line.strip() else ''
            if not dev: continue
            r=run(['smartctl','-H',dev],15,False); text=(r.stdout or '')+(r.stderr or '')
            healthy=None
            if re.search(r'(PASSED|OK)',text,re.I): healthy=True
            elif re.search(r'(FAILED|FAIL)',text,re.I): healthy=False
            devices.append({"device":dev,"healthy":healthy})
    except Exception: pass
    vals=[d['healthy'] for d in devices if d['healthy'] is not None]
    return {"available":True,"healthy":all(vals) if vals else None,"devices":devices}

def update_summary():
    if not shutil.which('apt'): return {"available":False,"upgradable":None,"security":None}
    try:
        p=run(['apt','list','--upgradable'],25,False); lines=[x for x in p.stdout.splitlines() if '/' in x and not x.startswith('Listing')]
        security=sum(1 for x in lines if re.search(r'security',x,re.I))
        return {"available":True,"upgradable":len(lines),"security":security}
    except Exception as e: return {"available":True,"upgradable":None,"security":None,"error":str(e)}


def update_details():
    base=update_summary()
    base["rebootRequired"]=Path('/var/run/reboot-required').exists()
    pkgs=[]
    if shutil.which('apt'):
        try:
            r=run(['apt','list','--upgradable'],30,False)
            for line in r.stdout.splitlines():
                if '/' not in line or line.startswith('Listing'): continue
                name=line.split('/',1)[0].strip()
                if name: pkgs.append({"name":name,"security":bool(re.search(r'security',line,re.I)),"raw":line.strip()[:500]})
        except Exception: pass
    base["packages"]=pkgs[:250]
    return base

UPDATE_STATE_FILE=Path('/var/lib/classroom-hub/update-status.json')
UPDATE_SERVICE='classroom-hub-update.service'
APP_UPDATE_STATE_FILE=Path('/var/lib/classroom-hub/app-update-status.json')
APP_UPDATE_REQUEST_FILE=Path('/var/lib/classroom-hub/app-update-request.json')
APP_UPDATE_SERVICE='classroom-hub-app-update.service'
RELEASE_REF_RE=re.compile(r'^v?\d+\.\d+\.\d+(?:[.-][0-9A-Za-z.-]+)?$')
HUB_ROOT=Path(os.environ.get('CLASSROOM_HUB_DIR','/opt/classroom-hub')).resolve()
SERVICES_ROOT=Path(os.environ.get('HOST_SERVICES_DIR',os.environ.get('CLASSROOM_SERVICES_DIR','/opt/services'))).resolve()
DOCKER_NAME_RE=re.compile(r'^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$')
MANAGED_CONTAINERS={'classroom-control-hub','classroom-control-hub-maintenance','classroom-control-hub-tls','mosquitto','govee2mqtt','music-assistant-server','nodered','portainer'}
MANAGED_IMAGES={'eclipse-mosquitto:2.0.22','ghcr.io/wez/govee2mqtt:2025.04.13-17d43d72','nodered/node-red:4.1.14-22','ghcr.io/music-assistant/server:2.9.13'}

def allowed_managed_path(value):
    source=str(value).split(':',1)[0]
    try: resolved=Path(source).resolve(strict=False)
    except Exception: return False
    return resolved==SERVICES_ROOT or SERVICES_ROOT in resolved.parents or resolved==HUB_ROOT or HUB_ROOT in resolved.parents

def validate_docker_run(args):
    if args.count('--network') != 1 or args[args.index('--network')+1:args.index('--network')+2] != ['host']:
        raise RuntimeError('Managed integrations require exactly one --network host option')
    if any(x in ('-p', '--publish', '-P', '--publish-all') for x in args):
        raise RuntimeError('Published ports are not supported with host networking; configure the application listener')
    if args[-1] not in MANAGED_IMAGES: raise RuntimeError('Integration image is not pinned or allowlisted')
    i=1
    while i < len(args)-1:
        option=args[i]
        if option=='-d': i+=1; continue
        if option in ('--name','--restart','--network','-p','--publish','-v','--volume','-e','--env'):
            if i+1>=len(args)-1: raise RuntimeError(f'Missing value for Docker option {option}')
            value=args[i+1]
            if option=='--name' and value not in MANAGED_CONTAINERS: raise RuntimeError('Managed container name required')
            if option=='--restart' and value!='unless-stopped': raise RuntimeError('Unsupported restart policy')
            if option=='--network' and value!='host': raise RuntimeError('Unsupported Docker network')
            if option in ('-p','--publish') and not re.fullmatch(r'[0-9]{1,5}:[0-9]{1,5}',value): raise RuntimeError('Invalid published port')
            if option in ('-v','--volume') and (not allowed_managed_path(value) or 'docker.sock' in value): raise RuntimeError('Volume source is outside the managed roots')
            if option in ('-e','--env') and not re.fullmatch(r'[A-Z][A-Z0-9_]{0,127}=.{0,2048}',value,re.S): raise RuntimeError('Invalid container environment setting')
            i+=2; continue
        raise RuntimeError(f'Docker run option is not allowlisted: {option}')

def managed_docker(args, cwd=''):
    if not isinstance(args,list) or not args or len(args)>100 or any(not isinstance(x,str) or len(x)>4096 for x in args): raise RuntimeError('Invalid Docker request')
    args=[x.replace('/managed/services',str(SERVICES_ROOT)).replace('/managed/classroom-hub',str(HUB_ROOT)) for x in args]
    verb=args[0]
    if verb=='info':
        if len(args) not in (1,3) or len(args)==3 and (args[1]!='--format' or not args[2].startswith('{{')): raise RuntimeError('Unsupported Docker info arguments')
    elif verb=='ps':
        valid=args[1:] in ([],['-a']) or len(args) in (3,4) and args[-2]=='--format' and args[-1].startswith('{{') and args[1:-2] in ([],['-a'])
        if not valid: raise RuntimeError('Unsupported Docker process-list arguments')
    elif verb=='stats':
        valid=args[1:] in ([],['--no-stream']) or len(args) in (3,4) and args[-2]=='--format' and args[-1].startswith('{{') and args[1:-2] in ([],['--no-stream'])
        if not valid: raise RuntimeError('Unsupported Docker statistics arguments')
    elif verb=='images':
        valid=args[1:] in ([],['--filter','dangling=true']) or len(args) in (3,5) and args[-2]=='--format' and args[-1].startswith('{{') and args[1:-2] in ([],['--filter','dangling=true'])
        if not valid: raise RuntimeError('Unsupported Docker image-list arguments')
    elif verb in ('start','stop','restart','kill'):
        if len(args)!=2 or args[1] not in MANAGED_CONTAINERS: raise RuntimeError('Container is outside the managed allowlist')
    elif verb=='logs':
        if not args[-1] in MANAGED_CONTAINERS or any(x not in ('--timestamps','--tail') and not x.isdigit() and x not in MANAGED_CONTAINERS for x in args[1:]): raise RuntimeError('Unsupported Docker log request')
    elif verb=='inspect':
        if len(args)!=2 or args[1] not in MANAGED_CONTAINERS: raise RuntimeError('Container is outside the managed allowlist')
    elif verb=='rm':
        if len(args) not in (2,3) or args[-1] not in MANAGED_CONTAINERS or (len(args)==3 and args[1]!='-f'): raise RuntimeError('Unsupported container removal')
    elif verb=='compose':
        if cwd!='hub' or any(x not in ('compose','config','--services','ps') for x in args): raise RuntimeError('Only read-only hub Compose inspection is allowed')
    elif verb=='run':
        validate_docker_run(args)
    else: raise RuntimeError('Docker operation is not allowlisted')
    p=run(['docker',*args],180,False)
    if p.returncode!=0: raise RuntimeError((p.stderr or p.stdout or 'Docker operation failed').strip())
    return {'ok':True,'stdout':p.stdout or '','stderr':p.stderr or ''}

def update_job_status(include_log=False):
    state={"phase":"idle","message":"No host update has been started.","ok":None,"rebootRequired":Path('/var/run/reboot-required').exists()}
    try:
        if UPDATE_STATE_FILE.exists(): state.update(json.loads(UPDATE_STATE_FILE.read_text()))
    except Exception as e: state['stateReadError']=str(e)
    svc=unit_state(UPDATE_SERVICE)
    state['service']=svc
    state['running']=svc.get('active') in ('active','activating')
    if include_log:
        p=run(['journalctl','-u',UPDATE_SERVICE,'-n','500','--no-pager','--output=short-iso'],25,False)
        state['log']=((p.stdout or '')+(p.stderr or ''))[-50000:]
    return state

def start_update_job():
    current=update_job_status(False)
    if current.get('running'): raise RuntimeError('A host update job is already running')
    audit=run(['dpkg','--audit'],20,False)
    if audit.stdout.strip() or audit.returncode!=0: raise RuntimeError('dpkg --audit reports package problems. Repair the host before starting updates: '+(audit.stdout or audit.stderr).strip())
    check=run(['apt-get','check'],60,False)
    if check.returncode!=0: raise RuntimeError('apt-get check failed: '+(check.stderr or check.stdout).strip())
    p=run(['systemctl','start','--no-block',UPDATE_SERVICE],20,False)
    if p.returncode!=0: raise RuntimeError((p.stderr or p.stdout or 'Unable to start host update service').strip())
    return {"ok":True,"started":True,"job":update_job_status(False)}

def app_update_job_status(include_log=False):
    state={"phase":"idle","message":"No application update has been started.","ok":None}
    try:
        if APP_UPDATE_STATE_FILE.exists(): state.update(json.loads(APP_UPDATE_STATE_FILE.read_text()))
    except Exception as e: state['stateReadError']=str(e)
    svc=unit_state(APP_UPDATE_SERVICE); state['service']=svc; state['running']=svc.get('active') in ('active','activating')
    if include_log:
        p=run(['journalctl','-u',APP_UPDATE_SERVICE,'-n','500','--no-pager','--output=short-iso'],25,False)
        state['log']=((p.stdout or '')+(p.stderr or ''))[-50000:]
    return state

def start_app_update_job(body):
    current=app_update_job_status(False)
    if current.get('running'): raise RuntimeError('An application update is already running')
    if APP_UPDATE_REQUEST_FILE.exists(): raise RuntimeError('An application update request is already pending')
    action=str(body.get('action') or 'update')
    if action not in ('update','revert'): raise RuntimeError('Unsupported application update action')
    commit=run(['git','-C',str(HUB_ROOT),'rev-parse','HEAD'],20).stdout.strip()
    try: version=(HUB_ROOT/'VERSION').read_text().strip()
    except Exception: version=''
    request={"action":action,"targetRef":"","targetCommit":"","expectedVersion":"","rollbackCommit":commit,"rollbackVersion":version,"backupName":str(body.get('backupName') or ''),"backupSha256":str(body.get('backupSha256') or ''),"failureBackupName":str(body.get('failureBackupName') or body.get('backupName') or ''),"failureBackupSha256":str(body.get('failureBackupSha256') or body.get('backupSha256') or ''),"previousHubImage":"","previousMaintenanceImage":"","githubToken":str(body.get('githubToken') or '')}
    if len(request['githubToken'])>1000: raise RuntimeError('GitHub token is too long')
    if not re.fullmatch(r'[A-Za-z0-9._-]{1,180}',request['backupName']): raise RuntimeError('A valid pre-update backup is required')
    if not re.fullmatch(r'[0-9a-f]{64}',request['backupSha256']): raise RuntimeError('A valid pre-update backup checksum is required')
    if not re.fullmatch(r'[0-9a-f]{64}',request['failureBackupSha256']): raise RuntimeError('A valid failure-recovery backup checksum is required')
    if action=='update':
        ref=str(body.get('targetRef') or ''); version=str(body.get('expectedVersion') or '')
        if not RELEASE_REF_RE.fullmatch(ref): raise RuntimeError('Only semantic-version GitHub release tags are accepted')
        if not RELEASE_REF_RE.fullmatch(version): raise RuntimeError('Invalid expected release version')
        request.update({"targetRef":ref,"expectedVersion":version})
    else:
        if str(body.get('confirm') or '')!='REVERT_RELEASE': raise RuntimeError('Explicit REVERT_RELEASE confirmation required')
        if current.get('revertAvailable') is not True: raise RuntimeError('No unused verified rollback point is available')
        commit=str(current.get('previousCommit') or ''); version=str(current.get('previousVersion') or '')
        backup=str(current.get('backupName') or request['backupName'])
        backup_sha=str(current.get('backupSha256') or request['backupSha256'])
        if not re.fullmatch(r'[0-9a-f]{40}',commit): raise RuntimeError('No verified previous release is available to revert')
        if not re.fullmatch(r'[0-9a-f]{64}',backup_sha): raise RuntimeError('No verified rollback backup checksum is available')
        failure_backup=str(body.get('failureBackupName') or '')
        failure_backup_sha=str(body.get('failureBackupSha256') or '')
        if not re.fullmatch(r'[A-Za-z0-9._-]{1,180}',failure_backup): raise RuntimeError('A valid pre-revert backup is required')
        if not re.fullmatch(r'[0-9a-f]{64}',failure_backup_sha): raise RuntimeError('A valid pre-revert backup checksum is required')
        hub_image=str(current.get('previousHubImage') or ''); maintenance_image=str(current.get('previousMaintenanceImage') or '')
        if not re.fullmatch(r'sha256:[0-9a-f]{64}',hub_image) or not re.fullmatch(r'sha256:[0-9a-f]{64}',maintenance_image): raise RuntimeError('The immutable rollback images are no longer available')
        request.update({"targetCommit":commit,"expectedVersion":version,"backupName":backup,"backupSha256":backup_sha,"failureBackupName":failure_backup,"failureBackupSha256":failure_backup_sha,"previousHubImage":hub_image,"previousMaintenanceImage":maintenance_image})
    APP_UPDATE_REQUEST_FILE.parent.mkdir(parents=True,exist_ok=True)
    temp=APP_UPDATE_REQUEST_FILE.with_suffix('.tmp'); temp.write_text(json.dumps(request,indent=2)); os.chmod(temp,0o600); temp.replace(APP_UPDATE_REQUEST_FILE)
    p=run(['systemctl','start','--no-block',APP_UPDATE_SERVICE],20,False)
    if p.returncode!=0:
        APP_UPDATE_REQUEST_FILE.unlink(missing_ok=True)
        raise RuntimeError((p.stderr or p.stdout or 'Unable to start application update service').strip())
    return {"ok":True,"started":True,"request":{"action":action,"targetRef":request['targetRef'],"expectedVersion":request['expectedVersion'],"backupName":request['backupName']},"job":app_update_job_status(False)}

def migration_snapshots():
    base=Path('/opt/classroom-control-hub-backups'); items=[]
    if base.exists():
        for x in base.glob('migration-*'):
            if not x.is_dir(): continue
            try:
                size=sum(f.stat().st_size for f in x.rglob('*') if f.is_file())
                mt=x.stat().st_mtime
                items.append({"name":x.name,"path":str(x),"size":size,"modifiedAt":datetime.fromtimestamp(mt,timezone.utc).isoformat()})
            except Exception: pass
    return sorted(items,key=lambda x:x.get('modifiedAt') or '',reverse=True)

def prune_migration_snapshots(keep):
    keep=max(2,min(100,int(keep)))
    items=migration_snapshots(); removed=[]
    for x in items[keep:]:
        p=Path(x['path'])
        if p.parent!=Path('/opt/classroom-control-hub-backups') or not p.name.startswith('migration-'): continue
        shutil.rmtree(p); removed.append(x)
    return {"ok":True,"keep":keep,"removed":removed,"removedCount":len(removed),"remaining":len(items)-len(removed)}

def cleanup_legacy_batch(paths, action):
    if not isinstance(paths,list) or not paths: raise RuntimeError('At least one legacy backup is required')
    if len(paths)>200: raise RuntimeError('Batch too large')
    results=[]
    # Validate every candidate before changing any of them.
    for value in paths: validated_legacy_backup(value)
    for value in paths: results.append(cleanup_legacy_backup(value,action))
    return {"ok":True,"action":action,"count":len(results),"results":results}

def legacy_backups():
    out=[]
    opt=Path('/opt')
    if opt.exists():
        for p in sorted(opt.glob('classroom-hub-backup-*')):
            if not p.is_dir(): continue
            try:
                size=sum(f.stat().st_size for f in p.rglob('*') if f.is_file())
                modified=datetime.fromtimestamp(p.stat().st_mtime,timezone.utc).isoformat()
            except Exception:
                size=0; modified=None
            out.append({"type":"legacy-hub-backup","path":str(p),"size":size,"modifiedAt":modified,"recommendation":"archive-or-remove","safeDefault":False})
    return out


LEGACY_BACKUP_PREFIX = "/opt/classroom-control-hub-backup-"
LEGACY_ARCHIVE_ROOT = Path("/opt/classroom-control-hub-backups/legacy-archive")

def validated_legacy_backup(value):
    raw=str(value or "")
    p=Path(raw)
    try: resolved=p.resolve(strict=True)
    except FileNotFoundError: raise RuntimeError("Legacy backup path not found")
    if not resolved.is_dir() or not str(resolved).startswith(LEGACY_BACKUP_PREFIX):
        raise RuntimeError("Path is not an eligible legacy Classroom Control Hub backup")
    if resolved == Path('/opt/classroom-control-hub'):
        raise RuntimeError("Current Classroom Control Hub root is protected")
    return resolved

def cleanup_legacy_backup(path_value, action):
    src=validated_legacy_backup(path_value)
    if action=='archive':
        LEGACY_ARCHIVE_ROOT.mkdir(parents=True,exist_ok=True)
        dest=LEGACY_ARCHIVE_ROOT/src.name
        if dest.exists(): dest=LEGACY_ARCHIVE_ROOT/(src.name+'-'+datetime.now().strftime('%Y%m%d-%H%M%S'))
        shutil.move(str(src),str(dest))
        return {"ok":True,"action":"archive","source":str(src),"destination":str(dest)}
    if action=='delete':
        shutil.rmtree(src)
        return {"ok":True,"action":"delete","source":str(src),"deleted":True}
    raise RuntimeError("Unsupported cleanup action")

class Handler(BaseHTTPRequestHandler):
    server_version="ClassroomHubHostAgent/"+VERSION
    def log_message(self, fmt, *args):
        return
    def send_json(self, code, obj):
        raw=json.dumps(obj,separators=(',',':')).encode()
        self.send_response(code); self.send_header('Content-Type','application/json'); self.send_header('Content-Length',str(len(raw))); self.end_headers(); self.wfile.write(raw)
    def auth(self):
        if not TOKEN: self.send_json(503,{"ok":False,"error":"Host agent token not configured"}); return False
        if not hmac.compare_digest(self.headers.get('x-maintenance-token',''), TOKEN): self.send_json(401,{"ok":False,"error":"Unauthorized"}); return False
        return True
    def body(self):
        try:
            n=int(self.headers.get('Content-Length','0') or 0)
            return json.loads(self.rfile.read(n) or b'{}')
        except Exception: return {}
    def do_GET(self):
        if not self.auth(): return
        u=urllib.parse.urlparse(self.path); path=u.path; q=urllib.parse.parse_qs(u.query)
        try:
            if path=='/health':
                return self.send_json(200,{"ok":True,"version":VERSION,"socket":SOCKET_PATH,"systemd":shutil.which('systemctl') is not None})
            if path=='/system':
                disk=shutil.disk_usage('/')
                return self.send_json(200,{"ok":True,"version":VERSION,"hostname":socket_hostname(),"kernel":os.uname().release,"architecture":os.uname().machine,"cpuCount":os.cpu_count(),"uptimeSeconds":float(Path('/proc/uptime').read_text().split()[0]),"loadavg":os.getloadavg(),"memory":meminfo(),"disk":{"total":disk.total,"used":disk.used,"free":disk.free},"temperature":cpu_temperature(),"smart":smart_summary(),"updates":update_details(),"agentService":unit_state('classroom-control-hub-host-agent.service')})
            if path=='/services':
                items=list_services(); return self.send_json(200,{"ok":True,"agentVersion":VERSION,"items":items,"summary":{"total":len(items),"running":sum(x['active']=='active' for x in items),"integrated":sum(x.get('owner')=='integration' for x in items),"review":sum(x.get('owner')=='unmanaged' for x in items)}})
            m=re.fullmatch(r'/service/([^/]+)/logs',path)
            if m:
                name=urllib.parse.unquote(m.group(1))
                if not UNIT_RE.fullmatch(name): return self.send_json(400,{"ok":False,"error":"Invalid systemd unit name"})
                if name not in SERVICE_POLICY: return self.send_json(403,{"ok":False,"error":"Systemd unit is outside the managed allowlist"})
                tail=max(10,min(5000,int((q.get('tail') or ['300'])[0])))
                p=run(['journalctl','-u',name,'-n',str(tail),'--no-pager','--output=short-iso'],25,False)
                return self.send_json(200,{"ok":True,"name":name,"tail":tail,"text":(p.stdout or '')+(p.stderr or '')})
            if path=='/cleanup/legacy-backups':
                items=legacy_backups(); return self.send_json(200,{"ok":True,"items":items,"count":len(items)})
            if path=='/updates': return self.send_json(200,{"ok":True,**update_details(),"job":update_job_status(False)})
            if path=='/updates/job': return self.send_json(200,{"ok":True,**update_job_status(True)})
            if path=='/app-updates/job': return self.send_json(200,{"ok":True,**app_update_job_status(True)})
            if path=='/cleanup/migration-snapshots':
                items=migration_snapshots(); return self.send_json(200,{"ok":True,"items":items,"count":len(items)})
            return self.send_json(404,{"ok":False,"error":"Not found"})
        except Exception as e: return self.send_json(500,{"ok":False,"error":str(e)})
    def do_POST(self):
        if not self.auth(): return
        path=urllib.parse.urlparse(self.path).path
        try:
            if path in ('/updates/apply','/updates/start'):
                body=self.body()
                if str(body.get('confirm') or '')!='INSTALL_UPDATES': return self.send_json(400,{"ok":False,"error":"Explicit INSTALL_UPDATES confirmation required"})
                return self.send_json(202,start_update_job())
            if path=='/app-updates/start':
                body=self.body()
                if str(body.get('confirm') or '')!='INSTALL_RELEASE': return self.send_json(400,{"ok":False,"error":"Explicit INSTALL_RELEASE confirmation required"})
                return self.send_json(202,start_app_update_job(body))
            if path=='/app-updates/revert':
                body=self.body()
                return self.send_json(202,start_app_update_job({**body,"action":"revert"}))
            if path=='/docker/exec':
                body=self.body(); return self.send_json(200,managed_docker(body.get('args'),str(body.get('cwd') or '')))
            if path=='/cleanup/migration-retention':
                body=self.body()
                if str(body.get('confirm') or '')!='PRUNE_MIGRATIONS': return self.send_json(400,{"ok":False,"error":"Explicit PRUNE_MIGRATIONS confirmation required"})
                return self.send_json(200,prune_migration_snapshots(body.get('keep',10)))
            if path=='/cleanup/legacy-batch':
                body=self.body(); action=str(body.get('action') or ''); confirm=str(body.get('confirm') or '')
                expected='ARCHIVE_BATCH' if action=='archive' else 'DELETE_BATCH' if action=='delete' else ''
                if not expected or confirm!=expected: return self.send_json(400,{"ok":False,"error":"Explicit batch confirmation required"})
                return self.send_json(200,cleanup_legacy_batch(body.get('paths'),action))
            if path=='/cleanup/legacy-backup':
                body=self.body(); action=str(body.get('action') or ''); confirm=str(body.get('confirm') or '')
                expected='ARCHIVE' if action=='archive' else 'DELETE' if action=='delete' else ''
                if not expected or confirm!=expected: return self.send_json(400,{"ok":False,"error":f"Explicit {expected or 'valid'} confirmation required"})
                return self.send_json(200,cleanup_legacy_backup(body.get('path'),action))
            m=re.fullmatch(r'/service/([^/]+)/(start|stop|restart|enable|disable)',path)
            if not m: return self.send_json(404,{"ok":False,"error":"Not found"})
            name=urllib.parse.unquote(m.group(1)); action=m.group(2); body=self.body()
            if not UNIT_RE.fullmatch(name): return self.send_json(400,{"ok":False,"error":"Invalid systemd unit name"})
            policy=SERVICE_POLICY.get(name,{})
            if not policy: return self.send_json(403,{"ok":False,"error":"Systemd unit is outside the managed allowlist"})
            if policy.get('protected') and action in ('stop','disable'):
                return self.send_json(409,{"ok":False,"error":f"{name} is protected because Classroom Control Hub or host recovery depends on it"})
            if action in ('stop','disable') and body.get('confirm') is not True:
                return self.send_json(400,{"ok":False,"error":"Explicit confirmation required"})
            args=['systemctl',action]
            if action in ('enable','disable') and body.get('now') is True: args.append('--now')
            args.append(name)
            p=run(args,50,False)
            if p.returncode != 0: return self.send_json(500,{"ok":False,"error":(p.stderr or p.stdout).strip(),"output":(p.stdout or '')+(p.stderr or '')})
            return self.send_json(200,{"ok":True,"name":name,"action":action,"output":(p.stdout or '')+(p.stderr or ''),"state":unit_state(name)})
        except Exception as e: return self.send_json(500,{"ok":False,"error":str(e)})

def socket_hostname():
    try: return Path('/etc/hostname').read_text().strip()
    except Exception: return os.uname().nodename

class UnixHTTPServer(socketserver.UnixStreamServer):
    allow_reuse_address=True

if __name__=='__main__':
    Path(SOCKET_PATH).parent.mkdir(parents=True,exist_ok=True)
    try: os.unlink(SOCKET_PATH)
    except FileNotFoundError: pass
    server=UnixHTTPServer(SOCKET_PATH,Handler)
    os.chmod(SOCKET_PATH,0o660)
    print(f"Classroom Control Hub Host Agent {VERSION} listening on {SOCKET_PATH}",flush=True)
    if APP_UPDATE_REQUEST_FILE.exists():
        def resume_interrupted_update():
            run(['systemctl','start','--no-block',APP_UPDATE_SERVICE],20,False)
        threading.Timer(2.0,resume_interrupted_update).start()
    try: server.serve_forever()
    finally:
        server.server_close()
        try: os.unlink(SOCKET_PATH)
        except FileNotFoundError: pass
