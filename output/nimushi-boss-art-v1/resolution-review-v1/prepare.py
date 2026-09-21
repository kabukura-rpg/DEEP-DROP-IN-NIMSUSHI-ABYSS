from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
import json,shutil,hashlib
R=Path(__file__).resolve().parent
old=R.parent/'master-alignment-v1'
master=Image.open(old/'MASTER_NIMUSHI.png').convert('RGBA')
# Keep the preceding review's crop and logical content bounds exactly.
meta=json.loads((old/'manifest.json').read_text())
master.putalpha(master.getchannel('A').point(lambda x:255 if x>=128 else 0))
crop=master.crop(tuple(meta['postprocess']['crop']))
high=Image.new('RGBA',(256,224));high.paste(crop.resize((216,192),Image.Resampling.NEAREST),(16,16));high.save(R/'nimushi_idle_256.png')
shutil.copyfile(old/'nimushi_idle_lock_v1.png',R/'nimushi_idle_128.png')
low=Image.open(R/'nimushi_idle_128.png').resize((256,224),Image.Resampling.NEAREST)
# Reference preview: original detail sampled for display, not a proposed game asset.
ref=Image.new('RGBA',(256,224));ref.paste(crop.resize((216,192),Image.Resampling.LANCZOS),(16,16))
font=ImageFont.truetype('/System/Library/Fonts/Menlo.ttc',13)
comp=Image.new('RGBA',(828,270),'#14202a');d=ImageDraw.Draw(comp)
for i,(im,label) in enumerate([(ref,'MASTER reference'),(low,'A: 128 source / 256 display'),(high,'B: 256 source / 256 display')]):
 comp.alpha_composite(im,(10+i*276,34));d.text((10+i*276,10),label,font=font,fill='white')
comp.convert('RGB').save(R/'resolution-comparison.png')
high.resize((768,672),Image.Resampling.NEAREST).save(R/'256-enlarged.png')
meta.update(sourceCell=[256,224],displayCell=[256,224],scale=1,alphaBounds=list(high.getbbox()),pivot=[128,40],eyeAnchor=[128,114],paletteColors=len({p[:3] for p in high.getdata() if p[3]}),masterFile='../master-alignment-v1/MASTER_NIMUSHI.png',status='RESOLUTION AND ALIGNMENT HUMAN REVIEW PENDING')
meta['spriteSha256']=hashlib.sha256((R/'nimushi_idle_256.png').read_bytes()).hexdigest()
meta.pop('eyeOverlayTopLeft',None)
meta.pop('oldSpecEyeAnchor',None)
meta.pop('oldSpecPivot',None)
meta['postprocess']={'crop':meta['postprocess']['crop'],'resample':'NEAREST','paletteReduction':False,'alphaThreshold':128,'contentSize':[216,192],'offset':[16,16]}
(R/'manifest.json').write_text(json.dumps(meta,indent=2)+'\n')
# Reuse the isolated, paused runtime comparison without touching product code.
s=(old/'preview.html').read_text()
s=s.replace("const iframe=document.querySelector('iframe'),meta=await(await fetch('manifest.json')).json();", "const params=new URLSearchParams(location.search), resolution=params.get('resolution')==='128'?'128':'256';\nconst iframe=document.querySelector('iframe'),meta=await(await fetch(resolution==='128'?'../master-alignment-v1/manifest.json':'manifest.json')).json(), scale=256/meta.sourceCell[0];")
s=s.replace("img.src='nimushi_idle_lock_v1.png'", "img.src='nimushi_idle_'+resolution+'.png'")
s=s.replace('*2','*scale').replace('.setScale(2)','.setScale(scale)')
s=s.replace('window.review={alignment,','window.review={resolution,alignment,')
s=s.replace("textContent=alignment+", "textContent=resolution+'px source | alignment '+alignment+")
(R/'preview.html').write_text(s)
s=(old/'capture.mjs').read_text()
s=s.replace("for(const [name,width,height,overlay,alignment] of ['A','B'].flatMap(a=>[[a+'-desktop',1280,900,false,a],[a+'-mobile',390,844,false,a],[a+'-overlay',1280,900,true,a]])){", "for(const [name,width,height,overlay,alignment,resolution] of ['128','256'].flatMap(r=>['A','B'].flatMap(a=>[[r+'-'+a+'-desktop',1280,900,false,a,r],[r+'-'+a+'-mobile',390,844,false,a,r],[r+'-'+a+'-overlay',1280,900,true,a,r]]))){")
s=s.replace('master-alignment-v1/preview.html','resolution-review-v1/preview.html').replace("'?alignment='+alignment", "'?resolution='+resolution+'&alignment='+alignment")
(R/'capture.mjs').write_text(s)
print(meta['paletteColors'],meta['alphaBounds'])
