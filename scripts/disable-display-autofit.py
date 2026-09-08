#!/usr/bin/env python3
from pathlib import Path

p = Path('public/display/index.html')
s = p.read_text()

replacements = {
    "let textOptions={size:64,autoFit:true},titleOptions={size:92,autoFit:true},subtitleOptions={size:44,autoFit:true};":
    "let textOptions={size:64,autoFit:false},titleOptions={size:92,autoFit:false},subtitleOptions={size:44,autoFit:false};",
    "textOptions={...textOptions,...p,size:Number(p.size??textOptions.size??64),autoFit:p.autoFit!==false};":
    "textOptions={...textOptions,...p,size:Number(p.size??textOptions.size??64),autoFit:p.autoFit===true};",
    "titleOptions={...titleOptions,...p,size:Number(p.size??titleOptions.size??92),autoFit:p.autoFit!==false};":
    "titleOptions={...titleOptions,...p,size:Number(p.size??titleOptions.size??92),autoFit:p.autoFit===true};",
    "subtitleOptions={...subtitleOptions,...p,size:Number(p.size??subtitleOptions.size??44),autoFit:p.autoFit!==false};":
    "subtitleOptions={...subtitleOptions,...p,size:Number(p.size??subtitleOptions.size??44),autoFit:p.autoFit===true};",
}

for old, new in replacements.items():
    count = s.count(old)
    if count != 1:
        raise SystemExit(f'Expected one match, found {count}: {old}')
    s = s.replace(old, new)

p.write_text(s)
print('Configured display font sizes are now authoritative; auto-fit is opt-in only.')
