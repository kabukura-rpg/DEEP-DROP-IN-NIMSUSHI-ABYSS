"""Normalize generated candidates; pack integer cells. Approved base PNGs are copied unchanged."""
from pathlib import Path
from PIL import Image,ImageDraw
import json,shutil
R=Path(__file__).resolve().parent
P=R.parent/'player-visual-prototype-v1'
counts={'idle':2,'damage':2,'death':4,'run':4,'jump_rise':2,'fall':3,'gunboots_fire':2,'gunboots_brake':2,'landing':2,'wall_contact':1,'wall_kick':2,'boss_ascend':3,'boss_brake':2,'boss_hover':2,'boss_damage':2}
# Pixel landmarks on the 48px nearest-neighbor candidate: face center and eye-line.
landmarks={'idle':[(25,28),(25,28)],'damage':[(25,26),(25,26)],'death':[(25,28),(25,28),(25,30),(25,31)],'run':[(26,27)]*4,'jump_rise':[(25,20)]*2,'fall':[(24,30),(24,30),(24,29)],'gunboots_fire':[(24,29),(24,29)],'gunboots_brake':[(26,27),(26,27)],'landing':[(25,30),(25,29)],'wall_contact':[(26,27)],'wall_kick':[(23,25),(22,23)],'boss_ascend':[(24,21),(24,19),(24,21)],'boss_brake':[(24,26),(24,26)],'boss_hover':[(25,26),(25,26)],'boss_damage':[(24,20),(24,20)]}
base={'fall':('normal_fall',32),'boss_ascend':('boss_ascend',23),'boss_brake':('boss_brake',28)}
palette=sorted({p[:3] for f in (P/'sprites-48').glob('*.png') for p in Image.open(f).convert('RGBA').getdata() if p[3]})
cache={}
def nearest(c):
 if c not in cache:cache[c]=min(palette,key=lambda p:sum((p[i]-c[i])**2 for i in range(3)))
 return cache[c]
frames={};animations={}
for state,n in counts.items():
 group='shared' if state in ['idle','damage','death'] else 'boss' if state.startswith('boss_') else 'normal'
 ids=[]
 for i in range(n):
  name=f'{state}_{i:02}';dst=R/'frames'/f'{name}.png'
  if i==0 and state in base:
   source,ay=base[state];shutil.copyfile(P/'sprites-48'/f'{source}.png',dst);im=Image.open(dst).convert('RGBA');ax=24
  else:
   im=Image.open(R/'source'/f'{name}.png').convert('RGBA').resize((48,48),Image.Resampling.NEAREST)
   im.putdata([(*nearest(p[:3]),255) if p[3]>=128 else (0,0,0,0) for p in im.getdata()]);im.save(dst)
   ax,eye=landmarks[state][i];ay=eye+2
  frames[name]={'file':f'frames/{name}.png','anchor':{'x':ax,'y':ay},'group':group};ids.append(name)
 animations[state]={'frames':ids,'fps':16 if state in ['gunboots_brake','boss_brake','boss_hover'] else 10 if state=='run' else 12 if state in ['damage','boss_damage','gunboots_fire','landing','wall_kick'] else 8 if state=='death' else 6,'loop':state not in ['damage','boss_damage','death','landing','wall_kick','gunboots_fire']}
# Hand-clean the subtle loops from the approved raster. Generated variants changed
# tail length and face shape, so retain the locked raster and move only its tip 1px.
for state,box in [('fall',(8,3,19,9)),('boss_ascend',(12,41,26,46)),('boss_brake',(1,20,7,30))]:
 master=Image.open(R/'frames'/f'{state}_00.png').convert('RGBA')
 anchor=frames[f'{state}_00']['anchor']
 for i in range(1,counts[state]):
  name=f'{state}_{i:02}';f=frames[name];cleaned=master.copy();tip=master.crop(box)
  cleaned.paste((0,0,0,0),box)
  dx=(1 if i==1 else -1) if state!='boss_brake' else 0
  dy=1 if state=='boss_brake' else 0
  cleaned.alpha_composite(tip,(box[0]+dx,box[1]+dy));cleaned.save(R/f['file']);f['anchor']=anchor.copy()
  f['cleanup']='Generated motion candidate rejected for shape drift; approved raster retained with a 1px tail-tip cleanup variation'
for group in ['shared','normal','boss']:
 names=[n for n,f in frames.items() if f['group']==group];cols=4;sheet=Image.new('RGBA',(cols*48,((len(names)+cols-1)//cols)*48))
 for i,name in enumerate(names):
  x=i%cols*48;y=i//cols*48;sheet.paste(Image.open(R/frames[name]['file']),(x,y));frames[name].update(sheet=f'sheets/player_{group}_v1.png',index=i,x=x,y=y)
 sheet.save(R/'sheets'/f'player_{group}_v1.png')
manifest={'status':'DEV CANDIDATE / NOT FINAL ADOPTION','cell':48,'origin':[.5,.5],'palette':palette,'frames':frames,'animations':animations,'archived':'../player-visual-prototype-v1/sprites-48/boss_descend_thrust.png'}
(R/'animation-map.json').write_text(json.dumps(manifest,indent=2))
contact=Image.new('RGB',(960,180*((len(frames)+5)//6)),'#202b32');d=ImageDraw.Draw(contact)
for i,(name,f) in enumerate(frames.items()):
 im=Image.open(R/f['file']);x=i%6*160;y=i//6*180;big=im.resize((144,144),Image.Resampling.NEAREST);contact.paste(big,(x,y),big);d.text((x,y+145),name,fill='white')
contact.save(R/'previews'/'contact-sheet.png')
records=[json.loads(f.read_text()) for f in sorted((R/'records').glob('*.json'))];(R/'generation-record.json').write_text(json.dumps(records,ensure_ascii=False,indent=2))
print(f'{len(frames)} frames / {len(animations)} animations / 3 sheets; QA still required')
