from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
import json,hashlib
p=Path(__file__).resolve().parent
im=Image.open(p/'source/contact.png').convert('RGBA');alpha=im.getchannel('A').point(lambda a:255 if a>=128 else 0);im.putalpha(alpha);box=alpha.getbbox();crop=im.crop(box)
scale=min(36/crop.width,36/crop.height);size=tuple(round(v*scale) for v in crop.size)
small=crop.resize(size,Image.Resampling.NEAREST)
palette=[tuple(x) for x in json.loads((p.parent/'player-sprites-v1/animation-map.json').read_text())['palette']]
cache={}
def nearest(c):
 if c not in cache:cache[c]=min(palette,key=lambda p:sum((p[i]-c[i])**2 for i in range(3)))
 return cache[c]
small.putdata([(*nearest(px[:3]),255) if px[3] else (0,0,0,0) for px in small.getdata()])
out=Image.new('RGBA',(48,48));offset=((48-size[0])//2,(48-size[1])//2);out.paste(small,offset);out.save(p/'boss_contact_rebound_00.png');out.resize((480,480),Image.Resampling.NEAREST).save(p/'nearest-10x.png')
font=ImageFont.truetype('/System/Library/Fonts/Menlo.ttc',13)
comp=Image.new('RGBA',(576,255),'#14202a');d=ImageDraw.Draw(comp)
for i,(name,asset) in enumerate([('FALL',p.parent/'player-sprites-v1/frames/fall_00.png'),('LAND',p.parent/'player-sprites-v1/frames/landing_00.png'),('BOSS CONTACT',p/'boss_contact_rebound_00.png')]):
 src=Image.open(asset).convert('RGBA');comp.alpha_composite(src,(i*192+72,20));comp.alpha_composite(src.resize((144,144),Image.Resampling.NEAREST),(i*192+24,82));d.text((i*192+24,235),name,font=font,fill='white')
comp.convert('RGB').save(p/'comparison.png')
meta={'state':'BOSS_CONTACT_REBOUND','status':'ONE FRAME ART CANDIDATE / NOT CONNECTED','cell':[48,48],'logicalSize':[48,48],'origin':[0.5,0.5],'anchor':[24,24],'alphaBounds':out.getbbox(),'sourceCrop':box,'normalizedSize':size,'offset':offset,'palette':'Existing PLAYER v1 exact RGB palette; nearest mapping, no dithering','semantics':'Feet toward screen top under reversed gravity; candidate for existing bossContact damage+bounce+full reload, not a new successful stomp attack','sha256':hashlib.sha256((p/'boss_contact_rebound_00.png').read_bytes()).hexdigest()}
(p/'manifest.json').write_text(json.dumps(meta,indent=2)+'\n')
print(meta)
