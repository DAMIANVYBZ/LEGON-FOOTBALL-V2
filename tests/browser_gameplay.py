"""Run against `npm run dev -- --port 5173`; requires Playwright and Chromium."""
import json,math,os,shutil
from playwright.sync_api import sync_playwright
BASE=os.environ.get('FOOTBALL_TEST_URL','http://127.0.0.1:5173')
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=shutil.which('chromium'),headless=True,args=['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--autoplay-policy=no-user-gesture-required'])
    errors=[]
    def open_match(venue):
        context=browser.new_context(viewport={'width':1100,'height':720})
        page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
        page.goto(BASE+'/?venue='+venue)
        page.get_by_role('button',name='YES · OPEN FOOTBALL').click()
        if venue=='astro':
            page.get_by_role('button',name='BOOK ASTROTURF').click()
            page.get_by_role('button',name='RESERVE & PLAY').click()
        else:page.get_by_role('button',name='KICK OFF').click()
        page.wait_for_function('window.__footballDebug?.snapshot().started',timeout=180000)
        page.evaluate('window.requestAnimationFrame=()=>0');page.wait_for_timeout(150)
        return context,page
    context,page=open_match('ug-stadium')
    snap=page.evaluate('__footballDebug.snapshot()')
    assert len(snap['players'])==20 and sum(p['keeper'] for p in snap['players'])==2
    assert snap['players'][10]['keeper'] and not snap['players'][7]['keeper']
    assert page.locator('.radar .dot').count()==21
    page.evaluate("""window.pad={index:0,connected:true,id:'DualSense',mapping:'standard',axes:[0,0,0,0],buttons:Array.from({length:17},()=>({pressed:false,value:0}))};Object.defineProperty(navigator,'getGamepads',{value:()=>[pad]})""")
    results={}
    for mode in ['jog','full','controlled']:
        page.evaluate("""mode=>{pad.buttons.forEach(b=>{b.pressed=false;b.value=0});__footballDebug.pollGamepad();const s=__footballDebug.snapshot(),controlled=s.controlled;__footballDebug.scenario({ball:[26.4,.11,0],owner:controlled,controlLockFor:60,players:s.players.map((p,index)=>({index,x:index===controlled?26:-28+(index%3)*2,z:index===controlled?0:(index%2?-18:18),heading:0,freezeFor:60,stamina:1}))});__footballDebug.move(1,0);if(mode!=='jog'){const i=mode==='full'?5:7;pad.buttons[i].pressed=true;pad.buttons[i].value=1}__footballDebug.pollGamepad();__footballDebug.step(.5)}""",mode)
        # Holding a shot in the penalty-area approach must not disable sprint.
        page.evaluate('pad.buttons[2].pressed=true;pad.buttons[2].value=1;__footballDebug.pollGamepad()')
        assert page.evaluate('__footballDebug.snapshot().input.shootHold')
        page.evaluate('__footballDebug.step(.4)')
        s=page.evaluate('__footballDebug.snapshot()');player=s['players'][s['controlled']]
        results[mode]={'speed':math.hypot(player['vx'],player['vz']),'gap':math.hypot(s['ball'][0]-player['x'],s['ball'][2]-player['z']),'x':player['x'],'owner':s['possessor'],'charge':s['input']['power']}
        assert s['possessor']==s['controlled'] and results[mode]['charge']>0
    assert results['full']['speed']>7.3,results
    assert results['controlled']['speed']>5.5,results
    assert .72<results['controlled']['speed']/results['full']['speed']<.78,results
    assert results['full']['speed']>results['jog']['speed']*1.4,results
    assert results['full']['x']>results['controlled']['x']>results['jog']['x'],results
    print('Penalty-area approach while charging a shot:',json.dumps(results),flush=True)
    context.close()
    context,page=open_match('astro')
    s=page.evaluate('__footballDebug.snapshot()')
    assert len(s['players'])==14 and sum(p['keeper'] for p in s['players'])==2
    assert s['players'][7]['keeper'] and page.locator('.radar .dot').count()==15
    assert not errors,errors
    print('PASS: 10v10 with one keeper each; R1/R2 faster than jogging while dribbling and charging near goal; R2 about 75% of R1; Presec still 7v7 with correct keepers/radar. No browser errors.',flush=True)
    context.close();browser.close()
