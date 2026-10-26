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
import argparse, json, math, shutil, tempfile
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

    def open_saved(index=0):
        page.locator('[data-nav-view=trips]').tap()
        page.locator('.trip-card').filter(has_text='Trip+ contrôle réel').wait_for()
        page.locator('.trip-card').filter(has_text='Trip+ contrôle réel').tap()
        page.locator('[data-nav-view=trip]').tap()
        page.locator('[data-league-calendar] [data-action=open-day-detail]').nth(index).tap()
        page.locator('[data-day-detail-profile] [data-profile-interactive]').wait_for()
    open_saved()
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
    assert page.locator('[data-day-detail-stats] dl>div').count() == 9
    assert page.locator('[data-day-detail-stats]').bounding_box()['y'] < page.locator('[data-day-detail-map]').bounding_box()['y']
    page.screenshot(path=str(OUT / '01-etape-mobile.png'))
    page.locator('[data-day-detail] [data-day-tab=course]').tap()
    assert page.locator('[data-day-detail-profile]').evaluate('(el)=>el.parentElement.hasAttribute("data-course-profile-target")')
    assert not page.locator('[data-day-detail-profile] .profile-modes').is_visible()
    page.locator('[data-segment-add]').tap()
    page.locator('[data-segment-field=type]').select_option('climb')
    page.locator('[data-segment-field=name]').fill('Grimpeur 1')
    page.locator('[data-segment-field=start]').fill('0')
    page.locator('[data-segment-field=end]').fill('18.4')
    page.locator('[data-segment-save]').tap()
    page.wait_for_function('document.querySelector("[data-segment-view]")!==null')
    page.locator('[data-day-detail] [data-day-tab=route]').tap()
    assert page.locator('[data-day-detail-profile]').evaluate('(el)=>el.parentElement.hasAttribute("data-day-profile-home")')
    page.locator('[data-day-detail] [data-day-tab=weather]').tap()
    assert page.locator('#day-bottom-panel-weather').is_visible()
    assert not page.locator('[data-day-detail-map-profile-card]').is_visible()
    page.locator('[data-day-detail] [data-day-tab=infos]').tap()
    assert page.locator('[data-day-detail] [data-day-panel=infos]').is_visible()
    page.locator('[data-day-detail] [data-day-tab=route]').tap()
    page.locator('[data-segment-view]').tap()
    profile_id = page.locator('[data-segment-view]').get_attribute('aria-controls')
    assert page.locator('#' + profile_id + ' [data-climb-profile-interactive]').is_visible()
    assert page.locator('#' + profile_id + ' [data-climb-color-bands] rect').count() <= 40
    mini = page.locator('#' + profile_id + ' [data-climb-profile-interactive]')
    mini.scroll_into_view_if_needed()
    mini.evaluate('el => el.addEventListener("pointerdown", () => {window.miniContactVisible=!el.closest("[data-climb-profile]").querySelector("[data-profile-tooltip]").hidden}, {once:true})')
    mini.tap()
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
    toggle = dialog.locator('[data-map-layers-toggle]')
    assert toggle.is_visible()
    toggle.tap()
    page.wait_for_function('document.querySelectorAll("[data-trip-overview-map-dialog] .overview-stage-label").length===3')
    page.wait_for_function('[...document.querySelectorAll("[data-trip-overview-map-dialog] .overview-stage-label")].every(el=>Number(getComputedStyle(el).opacity)>=.85)')
    dialog.locator('[data-map-layers-toggle]').tap()
    page.wait_for_function('document.querySelectorAll("[data-trip-overview-map-dialog] .overview-stage-label").length===0')
    dialog.locator('[data-map-layers-toggle]').tap()
    page.wait_for_function('[...document.querySelectorAll("[data-trip-overview-map-dialog] .overview-stage-label")].filter(el=>Number(getComputedStyle(el).opacity)>=.85).length===3')
    for label in dialog.locator('.overview-stage-label').all():
        assert label.bounding_box()['width'] > 100
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
    dialog.locator('[data-map-layers-toggle]').tap()
    page.wait_for_function('document.querySelectorAll("[data-trip-overview-map-dialog] .overview-stage-label").length===3 && [...document.querySelectorAll("[data-trip-overview-map-dialog] .overview-stage-label")].every(el=>Number(getComputedStyle(el).opacity)>=.85)')
    dialog.locator('[data-map-layers-toggle]').tap()
    page.wait_for_function('document.querySelectorAll("[data-trip-overview-map-dialog] .overview-stage-label").length===0')
    dialog.locator('[data-map-layers-toggle]').tap()
    page.wait_for_function('[...document.querySelectorAll("[data-trip-overview-map-dialog] .overview-stage-label")].filter(el=>Number(getComputedStyle(el).opacity)>=.85).length===3')
    for label in dialog.locator('.overview-stage-label').all():
        assert label.bounding_box()['width'] > 100
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
    assert not errors, errors
    print('Artifacts:', OUT)
    print(json.dumps({'production': True, 'gpxImport': 3, 'longRouteKm': 150, 'allStats': 9, 'tabs': 4, 'sharedCourseProfile': True, 'bottomStagePicker': True, 'neutralOnOtherStage': True, 'stableWindSlot': True, 'adaptiveBands': True, 'overviewLines': 3, 'overviewLabels': 3, 'selectionAndNavigation': True, 'offlineFonts': len(cached), 'sameGpxVertices': len(source), 'offlineGpxFit': True, 'offlineReload': True, 'walkingOffline': True, 'widths': [320, 390, 430], 'nativeFieldsFit': True, 'touchReadingsClear': True, 'simulatedSafeTopPx': 59, 'tourLabels': ['J1a', 'J1b', 'J2'], 'jsErrors': errors}))
    browser.close()
