"""Contrôle d’intégration mobile Trip+ (contexte navigateur isolé).

Prérequis : pip install playwright, Chromium installé ou playwright install chromium.
Lancer npm run build, puis npm run preview -- --host 127.0.0.1 --port 4173.
Utilisation : python scripts/check-tripplus-mobile.py [--url URL] [--output DIR].

Les vrais GPX RGA sont importés via le wizard. Les tuiles et Open-Meteo sont
bloqués ; les captures montrent explicitement le repli réseau. Les scénarios
couvrent le profil de 150 km, les événements tactiles, les onglets, la carte,
les exports et les données/polices hors connexion, à vélo puis à pied.
Aucun stockage du navigateur personnel n’est ouvert ni modifié.
"""

from pathlib import Path
import argparse, hashlib, io, json, math, re, shutil, tempfile, zipfile
import xml.etree.ElementTree as ET
from playwright.sync_api import sync_playwright
parser = argparse.ArgumentParser(description='Contrôle tactile Trip+ sur un build Vite servi localement.')
parser.add_argument('--url', default='http://127.0.0.1:4173/bike-trip-dashboard/')
parser.add_argument('--output', type=Path)
parser.add_argument('--browser', default=shutil.which('chromium'))
args = parser.parse_args()
REPO = Path(__file__).resolve().parents[1]
OUT = args.output or Path(tempfile.mkdtemp(prefix='tripplus-mobile-'))
OUT.mkdir(parents=True, exist_ok=True)
gpx = sorted((REPO / 'public/trips/rga-2026/gpx').glob('*.gpx'))
pts = []
distance = 0
last = None
for file in gpx[:3]:
    for pt in ET.parse(file).findall('.//{*}trkpt'):
        lat, lon = (float(pt.attrib['lat']), float(pt.attrib['lon']))
        if last:
            a, b = last
            distance += 6371 * 2 * math.asin(min(1, math.sqrt(math.sin(math.radians(lat - a) / 2) ** 2 + math.cos(math.radians(a)) * math.cos(math.radians(lat)) * math.sin(math.radians(lon - b) / 2) ** 2)))
        if distance > 150:
            break
        pts.append(ET.tostring(pt, encoding='unicode'))
        last = (lat, lon)
    if distance > 150:
        break
long_xml = ('<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1"><trk><name>150 km Alpes</name><trkseg>' + ''.join(pts) + '</trkseg></trk></gpx>').encode()
(OUT / 'source-150km.gpx').write_bytes(long_xml)
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=args.browser, headless=True, args=['--no-sandbox'])
    context = browser.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True, timezone_id='Europe/Brussels', locale='fr-BE', accept_downloads=True)
    page = context.new_page()
    page.set_default_timeout(20000)
    def check_creator_credit(capture=False):
        credit=page.locator('[data-creator-credit]')
        note=page.locator('.creator-credit-dialog')
        assert credit.count()==1 and note.count()==1
        assert ' '.join(credit.inner_text().split())=='Trip+ by CGi'
        assert note.is_hidden()
        current_url=page.url
        for width in [320,390,430]:
            page.set_viewport_size({'width':width,'height':844})
            box=credit.bounding_box()
            assert box['width']>=44 and box['height']>=44,box
            assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
            credit.locator('.app-wordmark__credit').tap()
            note.wait_for(state='visible')
            assert 'imaginée et conçue par CGi' in note.inner_text()
            assert 'à vélo comme à pied' in note.inner_text() and 'saisons de course' in note.inner_text()
            box=note.bounding_box()
            assert box['x']>=0 and box['x']+box['width']<=width
            assert note.get_by_role('button',name='Fermer').bounding_box()['height']>=44
            if capture and width==390:
                page.screenshot(path=str(OUT / '15-note-createur.png'))
            note.get_by_role('button',name='Fermer').tap()
            note.wait_for(state='hidden')
            page.wait_for_function('document.activeElement?.hasAttribute("data-creator-credit")')
        page.set_viewport_size({'width':390,'height':844})
        credit.focus()
        page.keyboard.press('Enter')
        note.wait_for(state='visible')
        page.keyboard.press('Escape')
        note.wait_for(state='hidden')
        page.wait_for_function('document.activeElement?.hasAttribute("data-creator-credit")')
        assert page.url==current_url and note.count()==1
        if capture:
            page.locator('.app-header').screenshot(path=str(OUT / '14-signature.png'))

    def check_native_fields():
        for width in [320, 390, 430]:
            page.set_viewport_size({'width': width, 'height': 844})
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), width
            for field in page.locator('input[type=date], input[type=time]').all():
                if not field.is_visible():
                    continue
                fits = field.evaluate('''el => {
                    const r=el.getBoundingClientRect(), p=el.parentElement.getBoundingClientRect();
                    return r.left >= p.left-1 && r.right <= p.right+1 && r.right <= innerWidth;
                }''')
                assert fits, (width, field.get_attribute('id'), field.get_attribute('data-field'))
        page.set_viewport_size({'width': 390, 'height': 844})
    def check_overview_detail(dialog):
        # Détail adds landmarks, never permanent stage names. Without any
        # saved pause/named col, there is no empty toggle to display.
        assert dialog.locator('.overview-stage-number').count() == 3
        assert dialog.locator('.route-marker--start,.route-marker--finish').count() >= 2
        assert dialog.locator('.route-marker--race-start,.route-marker--race-finish,.overview-stage-label').count() == 0
        toggle = dialog.locator('[data-map-layers-toggle]')
        if toggle.is_visible():
            before = dialog.locator('.route-marker').count()
            toggle.tap()
            assert toggle.get_attribute('aria-pressed') == 'true'
            assert dialog.locator('.route-marker').count() > before
            assert dialog.locator('.overview-stage-label').count() == 0
            toggle.tap()
            assert dialog.locator('.route-marker').count() == before
    errors = []
    phase = ['import']
    page.on('pageerror', lambda e: errors.append({'phase': phase[0], 'stack': e.stack}))
    page.route('**/*open-meteo*', lambda r: r.abort())
    page.route('**://tile.openstreetmap.org/**', lambda r: r.abort())
    page.goto(args.url)
    page.wait_for_load_state('networkidle')
    page.evaluate('navigator.serviceWorker.ready')
    page.wait_for_function('navigator.serviceWorker.controller!==null')
    assert 'Trip+' in page.locator('.app-wordmark').inner_text()
    assert page.locator('meta[name=author]').get_attribute('content')=='CGi'
    html_source=page.request.get(args.url).text()
    assert re.search(r'<!--[\s\S]*?Trip\+ by CGi[\s\S]*?saisons de course[\s\S]*?-->',html_source), 'the attribution must survive the production HTML build'
    check_creator_credit(capture=True)
    page.locator('[data-nav-view=trips]').tap()
    page.locator('[data-action=create-trip]').tap()
    page.locator('#wizard-name').fill('Trip+ contrôle réel')
    page.locator('[data-organization-mode=league]').tap()
    page.locator('#wizard-files').set_input_files([{'name': '01.gpx', 'mimeType': 'application/gpx+xml', 'buffer': gpx[0].read_bytes()}, {'name': '02.gpx', 'mimeType': 'application/gpx+xml', 'buffer': gpx[1].read_bytes()}, {'name': '03-150km.gpx', 'mimeType': 'application/gpx+xml', 'buffer': long_xml}])
    page.wait_for_function('document.querySelectorAll("[data-field=event-date]").length===3')
    for i in range(3):
        page.locator('[data-field=event-date]').nth(i).fill(f'2026-10-{27 + i}')
        page.locator('[data-field=event-time]').nth(i).fill('08:00')
    check_native_fields()
    page.locator('[data-action=submit]').tap()
    page.locator('.trip-card').first.wait_for()
    assert page.locator('.trip-card [data-trip-mode]').inner_text()=='League'
    for width in [320,390,430]:
        page.set_viewport_size({'width':width,'height':844})
        boxes=[button.bounding_box() for button in page.locator('.trip-card__actions > .button').all()]
        assert len(boxes)==3 and max(box['y'] for box in boxes)-min(box['y'] for box in boxes)<1
        assert all(box['height']>=44 for box in boxes)
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    page.set_viewport_size({'width':390,'height':844})
    page.screenshot(path=str(OUT / '12-actions-activites.png'))

    def open_saved(index=0):
        page.locator('[data-nav-view=trips]').tap()
        page.locator('.trip-card').filter(has_text='Trip+ contrôle réel').wait_for()
        page.locator('.trip-card').filter(has_text='Trip+ contrôle réel').tap()
        page.locator('[data-nav-view=trip]').tap()
        page.locator('[data-league-calendar] [data-action=open-day-detail]').nth(index).tap()
        page.locator('[data-day-detail-profile] [data-profile-interactive]').wait_for()
    open_saved()
    departure = page.locator('[data-day-departure-value]')
    assert departure.evaluate('el=>getComputedStyle(el).color') == 'rgb(23, 91, 131)'
    assert departure.locator('.interaction-cue--edit[aria-hidden=true]').count() == 1
    assert departure.bounding_box()['height'] >= 44
    assert page.locator('[data-day-detail-stats]').evaluate('el=>getComputedStyle(el.querySelector("dd")).color') != 'rgb(23, 91, 131)', 'static values keep their information colour'
    departure.evaluate('el=>el.scrollIntoView({block:"center"})')
    page.screenshot(path=str(OUT / '13-actions-statistiques.png'))
    page.locator('[data-action=edit-day-departure-time]').tap()
    page.locator('.time-edit-dialog[open]').wait_for()
    check_native_fields()
    page.screenshot(path=str(OUT / '06-heure-mobile.png'))
    page.locator('[data-time-edit-cancel]').tap()
    assert page.locator('[data-day-departure-value]').inner_text() == '08:00'
    page.evaluate('document.documentElement.style.setProperty("--app-safe-top", "59px")')
    assert page.locator('.brand').bounding_box()['y'] >= 59
    assert page.locator('.app-header__actions').bounding_box()['y'] >= 59
    page.screenshot(path=str(OUT / '07-zone-encoche.png'))
    page.locator('[data-day-detail-profile]').scroll_into_view_if_needed()
    page.wait_for_function('''() => {
        const h=document.querySelector('.day-detail__sticky-header').getBoundingClientRect();
        const t=document.querySelector('[data-day-detail-tabs]').getBoundingClientRect();
        return Math.abs(h.top-59)<1 && t.top >= h.bottom-1;
    }''')
    page.evaluate('document.documentElement.style.removeProperty("--app-safe-top")')
    assert page.locator('[data-day-detail-tabs] [role=tab]').count() == 4
    for width in [320, 390, 430]:
        page.set_viewport_size({'width':width,'height':844})
        for tab in page.locator('[data-day-detail-tabs] [role=tab]').all():
            tab.tap()
            assert tab.get_attribute('aria-selected') == 'true'
            style=tab.evaluate('el=>({color:getComputedStyle(el).color,background:getComputedStyle(el).backgroundColor,height:el.getBoundingClientRect().height})')
            assert style['color']=='rgb(255, 255, 255)' and style['background']=='rgb(22, 63, 53)' and style['height']>=44,style
            assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    page.set_viewport_size({'width':390,'height':844})
    page.locator('[data-day-detail] [data-day-tab=route]').tap()
    assert page.locator('[data-day-detail-stats] dl>div').count() == 9
    assert page.locator('[data-day-detail-stats]').bounding_box()['y'] < page.locator('[data-day-detail-map]').bounding_box()['y']
    page.screenshot(path=str(OUT / '01-etape-mobile.png'))
    page.locator('[data-day-detail] [data-day-tab=course]').tap()
    assert page.locator('[data-day-detail-profile]').evaluate('(el)=>el.parentElement.hasAttribute("data-course-profile-target")')
    assert not page.locator('[data-day-detail-profile] .profile-modes').is_visible()
    page.locator('[data-race-editor] > summary').tap()
    page.locator('[data-race-offset=start]').fill('0.267')
    page.locator('[data-race-offset=finish]').fill('20.876')
    page.locator('[data-race-save]').tap()
    try:
        page.wait_for_function('document.querySelector("[data-race-offset=start]")?.value==="0.3" && document.querySelector("[data-race-offset=finish]")?.value==="20.9" && document.querySelector("[data-race-save]")?.disabled===false')
    except Exception:
        print(page.locator('[data-race-course-host]').inner_text())
        print(page.locator('[data-race-offset=start]').input_value(), page.locator('[data-race-offset=finish]').input_value())
        page.screenshot(path=str(OUT / 'bounds-failure.png'))
        raise
    page.locator('[data-race-editor] > summary').tap()
    page.locator('[data-race-reset]').tap()
    page.wait_for_function('document.querySelector("[data-race-overlay]")===null')
    page.locator('[data-segment-add]').tap()
    page.locator('[data-segment-field=type]').select_option('climb')
    page.locator('[data-segment-field=name]').fill('Grimpeur 1')
    page.locator('[data-segment-field=start]').fill('0')
    page.locator('[data-segment-field=end]').fill('18.4')
    page.locator('[data-segment-save]').tap()
    page.wait_for_function('document.querySelector("[data-segment-view]")!==null')
    page.locator('[data-segment-choose]').select_option(index=1)
    assert page.locator('[data-segment-delete]').is_visible()
    assert page.locator('[data-segment-delete]').evaluate('el=>getComputedStyle(el).color') != 'rgb(23, 91, 131)'
    page.locator('[data-segment-cancel]').tap()
    page.locator('[data-day-detail] [data-day-tab=route]').tap()
    assert page.locator('[data-day-detail-profile]').evaluate('(el)=>el.parentElement.hasAttribute("data-day-profile-home")')
    page.locator('[data-day-detail-map] .route-marker--race-climb').tap()
    stage_map=page.locator('[data-day-detail-map-dialog][open]')
    stage_map.wait_for()
    assert stage_map.locator('[data-map-layers-toggle], [data-map-layers-panel]').count()==0
    stage_map.locator('.route-marker--race-climb').tap()
    stage_map.locator('[data-route-feature-popup]').wait_for()
    assert '18,4 km' in stage_map.locator('[data-route-feature-popup]').inner_text()
    assert stage_map.locator('.leaflet-tooltip:visible').count() == 0
    page.wait_for_function('Number(getComputedStyle(document.querySelector(".leaflet-popup")).opacity)>=.95')
    page.screenshot(path=str(OUT / '10-fiche-unique-carte.png'))
    stage_map.locator('[data-close-map]').tap()
    page.locator('[data-day-detail] [data-day-tab=weather]').tap()
    assert page.locator('#day-bottom-panel-weather').is_visible()
    assert not page.locator('[data-day-detail-map-profile-card]').is_visible()
    page.locator('[data-day-detail] [data-day-tab=infos]').tap()
    assert page.locator('[data-day-detail] [data-day-panel=infos]').is_visible()
    page.locator('[data-day-detail] [data-day-tab=route]').tap()
    segment_row = page.locator('[data-segment-view]')
    assert segment_row.locator('.interaction-cue--expand').count() == 1
    assert segment_row.get_attribute('aria-expanded') == 'false'
    segment_row.evaluate('el=>el.scrollIntoView({block:"center"})')
    cue_box = segment_row.locator('.interaction-cue--expand').bounding_box()
    # A real tap on the decorative SVG must reach the existing disclosure.
    page.touchscreen.tap(cue_box['x']+cue_box['width']/2, cue_box['y']+cue_box['height']/2)
    assert segment_row.get_attribute('aria-expanded') == 'true'
    assert segment_row.locator('.interaction-cue .trip-icon').evaluate('el=>new DOMMatrix(getComputedStyle(el).transform).a') == -1
    page.wait_for_timeout(350)  # Capture the stable open state after native tap feedback.
    page.screenshot(path=str(OUT / '11-actions-segments.png'))
    segment_row.focus()
    page.keyboard.press('Enter')
    assert segment_row.get_attribute('aria-expanded')=='false'
    page.keyboard.press('Space')
    assert segment_row.get_attribute('aria-expanded')=='true'
    profile_id = page.locator('[data-segment-view]').get_attribute('aria-controls')
    assert page.locator('#' + profile_id + ' [data-climb-profile-interactive]').is_visible()
    assert page.locator('#' + profile_id + ' [data-climb-color-bands] rect').count() <= 40
    mini = page.locator('#' + profile_id + ' [data-climb-profile-interactive]')
    page.evaluate('''() => {
        window.profileCheckEvents=[];
        for(const type of ['pointerdown','click'])document.addEventListener(type,event=>{
            profileCheckEvents.push({type,tag:event.target.tagName,action:event.target.closest('[data-action]')?.dataset.action,segment:event.target.closest('[data-segment-view]')?.dataset.segmentView});
            if(profileCheckEvents.length>20)profileCheckEvents.shift();
        });
    }''')
    mini.scroll_into_view_if_needed()
    mini.evaluate('el => el.addEventListener("pointerdown", () => {window.miniContactVisible=!el.closest("[data-climb-profile]").querySelector("[data-profile-tooltip]").hidden}, {once:true})')
    try:
        mini.tap()
    except Exception:
        page.screenshot(path=str(OUT / 'mini-profile-failure.png'))
        print(json.dumps(page.evaluate('''() => ({
            tabs:[...document.querySelectorAll('[data-day-detail-tabs] [role=tab]')].map(el=>[el.dataset.dayTab,el.getAttribute('aria-selected')]),
            segments:[...document.querySelectorAll('[data-segment-view]')].map(el=>[el.dataset.segmentView,el.getAttribute('aria-expanded')]),
            profiles:[...document.querySelectorAll('[data-climb-profile-interactive]')].map(el=>({id:el.closest('[data-climb-profile]')?.id,hidden:el.closest('[data-climb-profile]')?.hidden,rect:el.getBoundingClientRect().toJSON()})),
            focused:document.activeElement?.outerHTML.slice(0,300),events:window.profileCheckEvents
        })''')))
        raise
    assert page.evaluate('window.miniContactVisible')
    assert page.locator('#' + profile_id + ' [data-profile-tooltip]').is_hidden()
    mini.focus()
    page.keyboard.press('ArrowRight')
    assert page.locator('#' + profile_id + ' [data-profile-tooltip]').is_visible()
    page.keyboard.press('Escape')
    assert page.locator('#' + profile_id + ' [data-profile-tooltip]').is_hidden()
    page.locator('[data-timeline-filter=services]').tap()
    assert page.locator('[data-timeline-services]').is_visible()
    page.locator('[data-timeline-filter=all]').tap()
    select = page.locator('[data-stage-navigation]')
    select.select_option(index=2)
    page.wait_for_function('document.querySelector("[data-stage-navigation]")?.selectedIndex===2')
    page.locator('[data-day-detail-profile] [data-profile-mode=grade]').tap()
    assert page.locator('[data-day-detail-profile] [data-profile-color-bands] rect').count() < 65
    plot = page.locator('[data-day-detail-profile] [data-profile-interactive]')
    plot.scroll_into_view_if_needed()
    page.evaluate('document.querySelector("[data-day-detail-profile]").scrollIntoView({block:"start"})')
    before = page.locator('.course-exports').bounding_box()['y']
    box = plot.bounding_box()
    plot.evaluate('el => el.addEventListener("pointerdown", () => {window.mainContactValue=el.closest("[data-day-detail-profile]").querySelector("[data-profile-band-distance]").textContent}, {once:true})')
    page.touchscreen.tap(box['x'] + box['width'] * 0.42, box['y'] + box['height'] * 0.5)
    assert 'km' in page.evaluate('window.mainContactValue')
    assert page.locator('[data-profile-band-distance]').inner_text() == '—'
    assert plot.locator('[data-profile-cursor]').get_attribute('hidden') is not None
    assert abs(page.locator('.course-exports').bounding_box()['y'] - before) < 1
    assert page.locator('.profile-wind').is_visible()
    page.screenshot(path=str(OUT / '02-profil-150km-mobile.png'))
    select.select_option(index=0)
    page.wait_for_function('document.querySelector("[data-stage-navigation]")?.selectedIndex===0')
    assert page.locator('[data-day-detail-profile]').get_attribute('data-profile-color-mode') == 'neutral'
    phase[0] = 'overview'
    page.locator('[data-nav-view=today]').tap()
    page.locator('[data-trip-overview-map] .route-map-stage-line').first.wait_for()
    assert page.locator('[data-trip-overview-map] .route-map-stage-line').count() == 3
    page.locator('[data-trip-overview-map]').tap()
    page.locator('[data-trip-overview-map-dialog][open]').wait_for()
    dialog = page.locator('[data-trip-overview-map-dialog]')
    dialog.locator('.route-map-stage-line').first.wait_for()
    check_overview_detail(dialog)
    page.screenshot(path=str(OUT / '03-carte-etapes-mobile.png'))
    phase[0] = 'map-selection'
    dialog.locator('.overview-stage-number').first.tap()
    panel = dialog.locator('[data-overview-stage-selection]')
    panel.wait_for(state='visible')
    assert 'Voir l’étape' in panel.inner_text()
    assert '0.23' in dialog.locator('.route-map-stage-line').nth(1).get_attribute('stroke-opacity')
    panel.locator('[data-overview-all-stages]').tap()
    assert panel.locator('[data-overview-stage-choice]').input_value() == ''
    phase[0] = 'open-stage-from-map'
    dialog.locator('.overview-stage-number').first.tap()
    panel.locator('[data-action=open-day-detail]').tap()
    page.locator('[data-day-detail-profile]').wait_for()
    assert page.locator('[data-trip-overview-map-dialog][open]').count() == 0
    phase[0] = 'offline-exports'
    context.set_offline(True)
    with page.expect_download() as exported:
        page.locator('[data-action=download-enriched-gpx]').tap()
    data = Path(exported.value.path()).read_bytes()
    (OUT / 'export-course.gpx').write_bytes(data)
    source = ET.fromstring(gpx[0].read_bytes()).findall('.//{*}trkpt')
    copy = ET.fromstring(data).findall('.//{*}trkpt')
    assert [(x.attrib, x.findtext('{*}ele')) for x in source] == [(x.attrib, x.findtext('{*}ele')) for x in copy]
    with page.expect_download() as fit:
        page.locator('[data-action=download-fit-course]').tap()
    (OUT / 'export-course.fit').write_bytes(Path(fit.value.path()).read_bytes())
    cached = page.evaluate("async()=>{let urls=[];for(const key of await caches.keys()){let c=await caches.open(key);urls.push(...(await c.keys()).map(r=>r.url))}return urls.filter(u=>u.includes('.woff'))}")
    assert len(cached) >= 2, cached
    phase[0] = 'offline-reload'
    page.reload()
    page.wait_for_load_state('networkidle')
    open_saved()
    assert page.locator('[data-segment-view]').count() == 1
    assert page.locator('[data-day-detail-profile]').get_attribute('data-profile-color-mode') == 'neutral'
    for width in [320, 390, 430]:
        page.set_viewport_size({'width': width, 'height': 844})
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'), width
        assert page.locator('.day-detail__floating-nav').bounding_box()['y'] < page.locator('.app-nav').bounding_box()['y']
    page.locator('[data-nav-view=trips]').tap()
    page.locator('[data-action=edit-trip]').first.tap()
    page.locator('[data-trip-editor]').wait_for()
    check_native_fields()
    page.locator('[data-action=set-travel-mode][data-travel-mode=walking]').tap()
    page.locator('[data-editor-action=save]').first.tap()
    page.wait_for_function('document.querySelector("[data-trip-editor]")===null')
    open_saved()
    assert page.locator('[data-day-detail-profile] [data-profile-mode=wind], [data-stage-wind-stat], [data-day-detail-profile] .profile-wind').count() == 0
    assert page.locator('[data-segment-view]').count() == 1
    page.screenshot(path=str(OUT / '05-randonnee-mobile.png'))
    with page.expect_download() as hiking:
        page.locator('[data-action=download-fit-course]').tap()
    (OUT / 'export-walking.fit').write_bytes(Path(hiking.value.path()).read_bytes())
    page.reload()
    page.wait_for_load_state('networkidle')
    open_saved()
    assert page.locator('[data-day-detail-profile] [data-profile-mode=wind], [data-stage-wind-stat], [data-day-detail-profile] .profile-wind').count() == 0
    page.set_viewport_size({'width': 390, 'height': 844})
    page.locator('[data-nav-view=trips]').tap()
    page.locator('[data-action=create-trip]').tap()
    page.locator('#wizard-name').fill('Route des Grandes Alpes')
    page.locator('[data-organization-mode=league]').tap()
    page.locator('#wizard-files').set_input_files([str(f) for f in gpx[:3]])
    page.wait_for_function('document.querySelectorAll("[data-field=event-date]").length===3')
    for i, name in enumerate(['Thonon-les-Bains → Morzine', 'Morzine → Le Grand-Bornand', 'Le Grand-Bornand → Beaufort']):
        page.locator('[data-field=stage-name]').nth(i).fill(name)
        page.locator('[data-field=event-date]').nth(i).fill(f'2026-10-{27 + i}')
        page.locator('[data-field=event-time]').nth(i).fill('08:00')
    page.locator('[data-action=submit]').tap()
    page.locator('.trip-card').filter(has_text='Route des Grandes Alpes').wait_for()
    page.locator('.trip-card').filter(has_text='Route des Grandes Alpes').tap()
    page.locator('[data-trip-overview-map]').tap()
    dialog = page.locator('[data-trip-overview-map-dialog]')
    dialog.locator('.route-map-stage-line').first.wait_for()
    check_overview_detail(dialog)
    page.screenshot(path=str(OUT / '03-carte-etapes-mobile.png'))
    dialog.locator('.overview-stage-number').first.tap()
    dialog.locator('[data-overview-stage-selection] [data-action=open-day-detail]').tap()
    page.locator('[data-day-detail-profile]').wait_for()
    page.screenshot(path=str(OUT / '01-etape-mobile.png'))
    assert not errors, errors
    # Tour: same-day identities and the editable start date survive offline.
    page.locator('[data-nav-view=trips]').tap()
    page.locator('[data-action=create-trip]').tap()
    page.locator('#wizard-name').fill('Tour — contrôle iPhone')
    page.locator('[data-action=set-race-mode][data-race-mode=on]').tap()
    page.locator('#wizard-start-date').fill('2026-10-27')
    page.locator('#wizard-files').set_input_files([str(f) for f in gpx[:3]])
    page.wait_for_function('document.querySelectorAll("[data-field=stage-name]").length===3')
    page.locator('[data-action=link-stage][data-position="1"]').tap()
    check_native_fields()
    page.locator('[data-action=submit]').tap()
    tour = page.locator('.trip-card').filter(has_text='Tour — contrôle iPhone')
    tour.wait_for()
    assert tour.locator('[data-trip-mode]').inner_text()=='Tour'
    tour.locator('[data-action=edit-trip]').tap()
    page.locator('#editor-start-date').wait_for()
    check_native_fields()
    page.screenshot(path=str(OUT / '08-date-edition-mobile.png'))
    page.locator('[data-editor-action=cancel]').first.tap()
    tour.tap()
    page.locator('[data-trip-overview-map]').tap()
    dialog = page.locator('[data-trip-overview-map-dialog]')
    dialog.locator('.overview-stage-number').first.wait_for()
    assert dialog.locator('.overview-stage-number').all_inner_texts() == ['J1a', 'J1b', 'J2']
    # The browser's native tap highlight fades outside the DOM/CSS animation API.
    page.wait_for_timeout(350)
    page.screenshot(path=str(OUT / '09-tour-jours-lies.png'))
    # Native dismissal must release the page, including the overview dialog.
    page.keyboard.press('Escape')
    dialog.wait_for(state='hidden')
    assert page.evaluate('!document.body.classList.contains("map-scroll-locked")')
    phase[0] = 'original-gpx-archive'
    with page.expect_download() as original_archive:
        page.locator('[data-action=download-trip-gpx]').tap()
    archive_bytes = Path(original_archive.value.path()).read_bytes()
    with zipfile.ZipFile(io.BytesIO(archive_bytes)) as archive:
        assert archive.testzip() is None
        assert len(archive.infolist()) == 3
        assert [archive.read(info) for info in archive.infolist()] == [file.read_bytes() for file in gpx[:3]]
        assert all(info.flag_bits & 0x800 for info in archive.infolist())
    phase[0] = 'backup-restore-offline'
    page.locator('[data-nav-view=trips]').tap()
    page.locator('.trip-card').first.wait_for()
    original_count = page.locator('.trip-card').count()
    assert original_count == 3
    page.locator('.trip-backup > summary').tap()
    page.locator('[data-backup-action=prepare]').tap()
    page.locator('[data-backup-action=download]').wait_for()
    with page.expect_download() as backup_download:
        page.locator('[data-backup-action=download]').tap()
    backup_bytes = Path(backup_download.value.path()).read_bytes()
    (OUT / 'sauvegarde-controle.zip').write_bytes(backup_bytes)
    with zipfile.ZipFile(io.BytesIO(backup_bytes)) as archive:
        assert archive.testzip() is None
        manifest = json.loads(archive.read('manifest.json'))
        assert len(manifest['trips']) == original_count
        for trip in manifest['trips']:
            assert not trip['missingSourceFileIds']
            for payload in trip['payloads']:
                raw = archive.read(payload['entry'])
                assert len(raw) == payload['sizeBytes']
                assert hashlib.sha256(raw).hexdigest() == payload['sha256']
        entry = archive.getinfo('manifest.json')
        data_start = entry.header_offset + 30 + len(entry.filename.encode()) + len(entry.extra)
    corrupted = bytearray(backup_bytes)
    corrupted[data_start] ^= 1
    page.locator('[data-backup-file]').set_input_files({'name':'endommage.zip','mimeType':'application/zip','buffer':bytes(corrupted)})
    page.wait_for_function('document.querySelector("[data-backup-status]")?.getAttribute("role")==="alert"')
    assert page.locator('[data-backup-action=restore]').count() == 0
    assert page.locator('.trip-card').count() == original_count
    page.locator('[data-backup-file]').set_input_files({'name':'voyages.zip','mimeType':'application/zip','buffer':backup_bytes})
    page.locator('[data-backup-action=restore]').wait_for()
    assert page.locator('.trip-card').count() == original_count, 'verification alone must not restore anything'
    page.locator('[data-backup-action=restore]').tap()
    page.wait_for_function('(count)=>document.querySelectorAll(".trip-card").length===count', arg=original_count*2)
    page.reload()
    page.wait_for_load_state('networkidle')
    page.locator('[data-nav-view=trips]').tap()
    page.wait_for_function('(count)=>document.querySelectorAll(".trip-card").length===count', arg=original_count*2)
    check_creator_credit()  # Also works after offline reload/restore.
    print(json.dumps({'originalGpxArchiveExact': True, 'backupHashesVerified': True, 'corruptBackupRejected': True, 'restoreCopiesOffline': original_count, 'nativeMapDismissal': True}))
    assert not errors, errors
    print('Artifacts:', OUT)
    print(json.dumps({'production': True, 'creatorCredit': True, 'creditOfflineAndKeyboard': True, 'sourceAttributionPreserved': True, 'gpxImport': 3, 'longRouteKm': 150, 'allStats': 9, 'tabs': 4, 'sharedCourseProfile': True, 'bottomStagePicker': True, 'neutralOnOtherStage': True, 'stableWindSlot': True, 'adaptiveBands': True, 'overviewLines': 3, 'overviewStageBubbles': 3, 'permanentStageNames': False, 'selectionAndNavigation': True, 'offlineFonts': len(cached), 'sameGpxVertices': len(source), 'offlineGpxFit': True, 'offlineReload': True, 'walkingOffline': True, 'widths': [320, 390, 430], 'nativeFieldsFit': True, 'touchReadingsClear': True, 'simulatedSafeTopPx': 59, 'tourLabels': ['J1a', 'J1b', 'J2'], 'jsErrors': errors}))
    browser.close()
