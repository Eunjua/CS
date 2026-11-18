"""아카데미 「통합+태그」(322634) export → [태그] 노드를 뺀 케어파트너(292497)용 JSON.
사용: python3 -I .claude/skills/alf/untag_partner.py <아카데미.json> <출력.json> [--name 이름] [--check <파트너현재.json>]
케어파트너에도 자동 태그가 붙으면 이 도구는 쓰지 않는다(SKILL.md 6-1)."""
import json,sys,copy
args=sys.argv[1:]
src,out=args[0],args[1]
name=args[args.index('--name')+1] if '--name' in args else '[케어아카데미] 통합 상담'
D=json.load(open(src)); T=D['task']
nodes={n['id']:n for n in T['nodes']}
tagids={i for i,n in nodes.items() if str(n.get('name','')).startswith('[태그]')}
bykey={n.get('key'):i for i,n in nodes.items()}
BJ=nodes[bykey['BJ']]; BK,BL,BM=bykey['BK'],bykey['BL'],bykey['BM']
intent_to={}
for c in BJ['next']['conditions']:
    f=c['filter']['and'][0]['or'][0]
    if f['key']=='taskMemory.intent': intent_to[f['values'][0]]=c['to']
E_ID=nodes[bykey['BN']]['next']['to']; H_ID=nodes[bykey['BO']]['next']['to']
problems=[]
def intent_of(flt):
    try:
        ors=flt['and'][0]['or']
        if len(flt['and'])==1 and len(ors)==1 and ors[0]['key']=='taskMemory.intent' and ors[0]['operator']=='$eq' and len(ors[0]['values'])==1: return ors[0]['values'][0]
    except Exception: pass
def fix(to,flt,where):
    if to==BK: return E_ID
    if to==BL: return H_ID
    if to==BM:
        it=intent_of(flt) if flt is not None else None
        if it in intent_to: return intent_to[it]
        if flt is None: return BJ['next']['default']
        problems.append(f'{where}: BM으로 가는 조건의 의도를 못 읽음'); return to
    if to in tagids: problems.append(f'{where}: 태그 노드 {nodes[to].get("key")}로 직접 연결'); 
    return to
new=[]
for n in T['nodes']:
    if n['id'] in tagids: continue
    m=copy.deepcopy(n); nx=m.get('next')
    if isinstance(nx,dict):
        for c in nx.get('conditions',[]): c['to']=fix(c['to'],c['filter'],f"{m.get('key')} 조건")
        if nx.get('default'): nx['default']=fix(nx['default'],None,f"{m.get('key')} 기본")
        if nx.get('to'): nx['to']=fix(nx['to'],None,f"{m.get('key')} 다음")
    new.append(m)
T2=copy.deepcopy(T); T2['nodes']=new; T2['name']=name
T2['memorySchema']=[x for x in T['memorySchema'] if not str(x.get('key','')).startswith('tag_')]
s=json.dumps(T2,ensure_ascii=False)
for i in tagids:
    if i in s: problems.append(f'태그 노드 id가 남음: {nodes[i].get("key")}')
D2=dict(D); D2['task']=T2
if 'taskEditorPosition' in D2:
    pos=D2['taskEditorPosition']
    if isinstance(pos,dict): D2['taskEditorPosition']={k:v for k,v in pos.items() if k not in tagids}
json.dump(D2,open(out,'w'),ensure_ascii=False,indent=2)
print(f'노드 {len(T["nodes"])} → {len(new)} (태그 {len(tagids)}개 뺌) · 저장: {out}')
print('문제:',problems or '없음')
if '--check' in args:
    P=json.load(open(args[args.index('--check')+1]))['task']
    def strip(o):
        if isinstance(o,dict): return {k:strip(v) for k,v in o.items() if k!='$index'}
        if isinstance(o,list): return [strip(x) for x in o]
        return o
    a,b=strip(T2),strip(P)
    diffs=[k for k in set(a)|set(b) if k!='nodes' and a.get(k)!=b.get(k)]
    pa={n['id']:n for n in a['nodes']}; pb={n['id']:n for n in b['nodes']}
    nd=[(pa[i].get('key'),[f for f in set(pa[i])|set(pb[i]) if pa[i].get(f)!=pb[i].get(f)]) for i in pa if i in pb and pa[i]!=pb[i]]
    print('케어파트너 현재와 비교 — 상단 칸 차이:',diffs,'· 아카데미에만:',[pa[i].get('key') for i in pa if i not in pb],'· 파트너에만:',[pb[i].get('key') for i in pb if i not in pa],'· 노드 차이:',nd or '없음')
