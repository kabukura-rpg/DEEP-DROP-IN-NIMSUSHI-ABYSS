from pathlib import Path
from PIL import Image,ImageDraw
import json
R=Path(__file__).resolve().parent
im=Image.open(R/'source.png').convert('RGBA');a=im.getchannel('A').point(lambda v:255 if v>=128 else 0);im.putalpha(a);box=a.getbbox();crop=im.crop(box)
s=min(108/crop.width,108/crop.height);size=(round(crop.width*s),round(crop.height*s));small=crop.resize(size,Image.Resampling.NEAREST)
pal=small.convert('RGB').quantize(colors=24,method=Image.Quantize.MEDIANCUT,dither=Image.Dither.NONE).convert('RGB').convert('RGBA');pal.putalpha(small.getchannel('A'))
out=Image.new('RGBA',(128,112));ox=round(64-(688-box[0])*s);oy=(112-size[1])//2;out.paste(pal,(ox,oy));out.save(R/'nimushi_idle_lock_v1.png')
eye=[round(ox+(688-box[0])*s),round(oy+(604-box[1])*s)];pivot=[eye[0],eye[1]-37]
meta={'status':'CHARACTER LOCK CANDIDATE','sourceCell':[128,112],'displayCell':[256,224],'scale':2,'alphaBounds':out.getbbox(),'paletteColors':len({p[:3] for p in out.getdata() if p[3]}),'eyeAnchor':eye,'pivot':pivot,'oldSpecEyeAnchor':[64,77],'oldSpecPivot':[64,40],'eyeOverlayTopLeft':[eye[0]-18,eye[1]-12],'placement':'pivot maps to actual body center including existing hit recoil; visual eye center is body center +74px','geometry':'Actual body/contact/eye getters read at capture time. No gameplay edits.','postprocess':{'alphaThreshold':128,'palette':24,'resample':'NEAREST','uniformScale':s,'crop':box,'offset':[ox,oy]},'eyes':'Both human eyes baked into this lock reference only; separate animated overlay deferred.'}
(R/'manifest.json').write_text(json.dumps(meta,indent=2));out.resize((256,224),Image.Resampling.NEAREST).save(R/'actual-size.png');out.resize((768,672),Image.Resampling.NEAREST).save(R/'enlarged.png')
player=Image.open(R.parents[1]/'player-sprites-v1/frames/idle_00.png').convert('RGBA');comp=Image.new('RGBA',(370,270),'#14202a');comp.alpha_composite(out.resize((256,224),Image.Resampling.NEAREST),(10,10));comp.alpha_composite(player,(294,186));d=ImageDraw.Draw(comp);d.text((10,242),'NIMUSHI 256x224 / PLAYER 48x48',fill='white');comp.convert('RGB').save(R/'player-size-comparison.png');print(json.dumps(meta))
