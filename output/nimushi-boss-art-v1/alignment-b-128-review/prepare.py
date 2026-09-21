from pathlib import Path
from PIL import Image
import json,shutil,hashlib
p=Path(__file__).resolve().parent
old=p.parent/'resolution-review-v1'
shutil.copyfile(old/'nimushi_idle_128.png',p/'nimushi_idle_128.png')
im=Image.open(p/'nimushi_idle_128.png')
for name,scale in [('display-256.png',2),('nearest-6x.png',6)]:im.resize((128*scale,112*scale),Image.Resampling.NEAREST).save(p/name)
shutil.copyfile(p.parent/'master-alignment-v1/player-size-comparison.png',p/'player-comparison.png')
s=(old/'capture.mjs').read_text().replace("['128','256'].flatMap(r=>['A','B'].flatMap", "['128'].flatMap(r=>['B'].flatMap")
(p/'capture.mjs').write_text(s)
meta={'source':[128,112],'display':[256,224],'pivot':[64,20],'renderOffsetY':-16,'contactSize':[168,82],'weakPointSize':[60,72],'visualEyes':2,'logicalWeakPoints':1,'method':'Existing immutable sprite reused; render translation only','spriteSha256':hashlib.sha256((p/'nimushi_idle_128.png').read_bytes()).hexdigest(),'alignmentApproval':'B HUMAN APPROVED / LOCKED at c1c1042; this export does not revoke prior approval','fullSheets':'NOT STARTED'}
(p/'manifest.json').write_text(json.dumps(meta,indent=2)+'\n')
