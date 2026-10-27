"""Route information checks against Vite source, with deterministic weather/POIs.

Run npm run dev -- --host 127.0.0.1, then this script. Requires Playwright
and Chromium. An isolated browser imports a synthetic GPX through the real
wizard; repository APIs seed the explicitly labelled test amenities.
"""
import argparse
import json
import shutil
import tempfile
from pathlib import Path
from playwright.sync_api import sync_playwright

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--url', default='http://127.0.0.1:5173/bike-trip-dashboard/')
parser.add_argument('--output', type=Path)
args = parser.parse_args()
output = args.output or Path(tempfile.mkdtemp(prefix='tripplus-route-info-'))
output.mkdir(parents=True, exist_ok=True)
points = []
for i in range(301):
    altitude = 200 + 6*i if i <= 80 else 680-10*(i-80) if i <= 120 else 280+5*(i-120) if i <= 240 else 880-10*(i-240)
    points.append(f'<trkpt lat="{45+i*.001}" lon="6"><ele>{altitude}</ele></trkpt>')
gpx = ('<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1"><trk><name>Deux cols</name><trkseg>'+''.join(points)+'</trkseg></trk></gpx>').encode()

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=shutil.which('chromium'), headless=True, args=['--no-sandbox'])
    page = browser.new_page(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True, locale='fr-BE', timezone_id='Europe/Brussels')
    page.set_default_timeout(15000)
    errors = []
    page.on('pageerror', lambda error: errors.append(error.stack))
    page.route('https://**', lambda route: route.abort())
    page.route('**/__route_information', lambda route: route.fulfill(content_type='text/html', body=f'<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="{args.url}src/style.css"><link rel="stylesheet" href="{args.url}src/ui/tripplus.css"><link rel="stylesheet" href="{args.url}src/ui/interaction-affordances.css"><div class="app-shell"><main class="dashboard"><div id="host"></div></main></div>'))
    page.goto(args.url+'__route_information')
    page.wait_for_load_state('networkidle')
    page.evaluate('''async root => {
      window.sourceRoot=root+'src/';
      const base=sourceRoot;
      const {openBikeTripDatabase}=await import(base+'storage/indexeddb/open-database.ts');
      const {createTripRepository}=await import(base+'storage/indexeddb/trip-repository.ts');
      const {initializeTripsManager}=await import(base+'ui/trips/trips-manager.ts');
      const map=await import(base+'ui/route-map.ts');
      window.mapTools=map;
      window.database=await openBikeTripDatabase(indexedDB);
      window.repository=createTripRepository(database);
      window.failLocalRead=false;
      const managedDatabase=new Proxy(database,{get(target,key){
        if(key==='transaction')return (...args)=>{if(failLocalRead)throw new DOMException('Injected local failure','UnknownError');return target.transaction(...args)};
        const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
      }});
      window.clockNow=Date.parse('2026-10-26T12:00:00Z'); window.weatherCalls=0;
      const now=()=>new Date(clockNow).toISOString();
      const provider={id:'open-meteo',async fetchForecast(request){
        weatherCalls++;
        return {provider:'open-meteo',requestKey:request.key,fetchedAt:now(),status:'success',datesCovered:request.requiredDates,issues:[],locations:request.locations.map(location=>({
          status:'success',requestLocationId:location.id,requestedLatitude:location.latitude,requestedLongitude:location.longitude,requestedElevationM:location.elevationM,providerLatitude:location.latitude,providerLongitude:location.longitude,providerElevationM:location.elevationM,timezone:request.timezone,utcOffsetSeconds:3600,missingVariables:[],issues:[],
          hourly:request.requiredDates.flatMap(date=>Array.from({length:24},(_,h)=>({time:date+'T'+String(h).padStart(2,'0')+':00',temperatureC:15,apparentTemperatureC:14,relativeHumidityPct:60,precipitationProbabilityPct:0,precipitationMm:0,rainMm:0,showersMm:0,snowfallCm:0,weatherCode:1,cloudCoverPct:0,visibilityM:20000,windSpeedKph:20,windDirectionDeg:0,windGustsKph:25,freezingLevelM:3000}))),
          daily:request.requiredDates.map(date=>({date,temperatureMinC:10,temperatureMaxC:20,apparentTemperatureMinC:9,apparentTemperatureMaxC:19,precipitationSumMm:0,precipitationProbabilityMaxPct:0,weatherCode:1,windSpeedMaxKph:20,windGustsMaxKph:25,windDirectionDominantDeg:0,sunrise:date+'T06:30',sunset:date+'T20:30'}))
        }))};
      }};
      let serial=0;
      window.manager=initializeTripsManager(document.querySelector('#host'),{database:managedDatabase,now,idFactory:()=> 'information-'+serial++,weatherProvider:provider,
        renderMap:(c,d,m,l,o)=>map.renderGenericRouteMap(c,d,m,l,o),closeMap:map.closeExpandedRouteMap,getMapInteractionHandle:map.getRouteMapInteractionHandle});
    }''', args.url)
    for mode in ['league', 'tour']:
        if mode == 'tour':
            page.evaluate('window.clockNow=Date.parse("2026-10-26T12:00:00Z")')
            page.evaluate('manager.goToList()')
        page.locator('[data-action=create-trip]').tap()
        page.locator('#wizard-name').fill('Informations '+mode)
        if mode == 'league':
            page.locator('[data-organization-mode=league]').tap()
        else:
            page.locator('[data-action=set-race-mode][data-race-mode=on]').tap()
            page.locator('#wizard-start-date').fill('2026-10-27')
        page.locator('#wizard-files').set_input_files({'name':'deux-cols.gpx','mimeType':'application/gpx+xml','buffer':gpx})
        page.locator('[data-field=stage-name]').wait_for()
        if mode == 'league':
            page.locator('[data-field=event-date]').fill('2026-10-27')
            page.locator('[data-field=event-time]').fill('08:00')
        page.locator('[data-action=submit]').tap()
        card=page.locator('.trip-card').filter(has_text='Informations '+mode)
        card.wait_for()
        trip_id=card.get_attribute('data-trip-id')
        assert card.locator('[data-trip-mode]').inner_text().lower()==mode
        length=page.evaluate('''async id=>{
          const base=sourceRoot;
          const {buildRaceCourse,applyRaceBounds}=await import(base+'analysis/race-bounds.ts');
          const {applyRaceSegmentChange}=await import(base+'analysis/race-segments.ts');
          const {DEFAULT_RACE_SEGMENT_ALERTS,validateTripBundle}=await import(base+'trip-core/index.ts');
          const {pointAtIndexedDistance}=await import(base+'route-enrichment/segment-geometry.ts');
          let bundle=await repository.loadTripBundle(id),stage=bundle.stages[0],course=buildRaceCourse(bundle,stage);
          const length=course.indexed.lengthKm;
          bundle=applyRaceBounds(bundle,stage.id,{startOffsetM:800,finishOffsetM:(length-1)*1000,routeFingerprint:course.fingerprint},course.fingerprint,new Date(clockNow).toISOString());
          bundle=applyRaceSegmentChange(bundle,stage.id,{kind:'add',id:id+'-segment',fields:{name:'Grimpeur du premier col',type:'climb',startOffsetM:2000,endOffsetM:5000,alerts:DEFAULT_RACE_SEGMENT_ALERTS}},course.fingerprint,new Date(clockNow).toISOString());
          bundle={...bundle,stages:bundle.stages.map((s,i)=>i===0?{...s,startLocationName:'Genappe',endLocationName:'Namur'}:s),climbs:bundle.climbs.map((c,i)=>({...c,name:i===bundle.climbs.length-1?'Col du contrôle':'Montée 1'}))};
          const specs=[{km:4,tags:{},name:'Ancien point sans potabilité'},{km:6,tags:{amenity:'drinking_water'},name:'Fontaine de la place'},
            {km:12,tags:{amenity:'drinking_water'},hours:'Tu 00:00-01:00',name:'Fontaine fermée au passage'},
            {km:15,tags:{amenity:'drinking_water',access:'private'},name:'Fontaine privée'},
            {km:24,tags:{amenity:'fountain',drinking_water:'yes'},name:'Fontaine du second col'}];
          bundle={...bundle,practicalPlaces:specs.map((spec,i)=>{
            const point=pointAtIndexedDistance(course.indexed,spec.km);
            return {id:id+'-water-'+i,category:'water',stageId:stage.id,dayIds:[stage.dayId],name:spec.name,latitude:point.latitude,longitude:point.longitude+.0004,description:null,trackDistanceKm:spec.km,detourKm:.035,openingHours:spec.hours??'24/7',hidden:false,pinned:false,usefulTags:spec.tags,provenance:{sourceType:'osm',sourceId:null,fetchedAt:new Date(clockNow).toISOString(),engineVersion:'browser-test',confidence:'high',manuallyOverridden:false}};
          })};
          const validation=validateTripBundle(bundle); if(!validation.ok)throw new Error(JSON.stringify(validation));
          await repository.saveTripBundle(bundle); return length;
        }''', trip_id)
        card.tap()
        page.evaluate('manager.goToDetailForActiveTrip()')
        page.locator('[data-action=open-day-detail]').first.tap()
        page.locator('[data-day-detail-profile]').wait_for()
        page.evaluate('manager.waitForWeatherIdle()')
        # Bounds use 0.1 km; editing one field preserves the untouched exact limit.
        original_finish=page.evaluate('async id=>(await repository.loadTripBundle(id)).stages[0].raceBounds.finishOffsetM', trip_id)
        page.locator('[data-day-tab=course]').tap()
        page.locator('[data-race-editor] > summary').tap()
        start=page.locator('[data-race-offset=start]')
        finish=page.locator('[data-race-offset=finish]')
        assert start.get_attribute('step')=='0.1' and finish.get_attribute('step')=='0.1'
        start.fill('1.234')
        finish.focus()
        assert start.input_value()=='1.2'
        page.locator('[data-race-save]').tap()
        page.wait_for_function('document.querySelector("[data-race-offset=start]")?.value==="1.2" && document.querySelector("[data-race-save]")?.disabled===false')
        bounds=page.evaluate('async id=>(await repository.loadTripBundle(id)).stages[0].raceBounds', trip_id)
        assert bounds['startOffsetM']==1200 and bounds['finishOffsetM']==original_finish
        page.locator('[data-race-editor] > summary').tap()
        finish.fill('30.167')
        start.focus()
        assert finish.input_value()=='30.2'
        page.locator('[data-race-pick=start]').tap()
        page.locator('[data-day-detail-profile]').evaluate('el=>el.dispatchEvent(new CustomEvent("profile-distance-active",{detail:{distanceKm:1.26}}))')
        assert start.input_value()=='1.3'
        page.locator('[data-day-detail-profile]').evaluate('el=>el.dispatchEvent(new CustomEvent("profile-sample-cleared"))')
        page.locator('[data-race-save]').tap()
        page.wait_for_function('document.querySelector("[data-race-offset=finish]")?.value==="30.2" && document.querySelector("[data-race-save]")?.disabled===false')
        bounds=page.evaluate('async id=>(await repository.loadTripBundle(id)).stages[0].raceBounds', trip_id)
        assert bounds['startOffsetM']==1300 and bounds['finishOffsetM']==30200
        page.locator('[data-day-tab=route]').tap()
        # Saving patches the same map host: the old child canvas must be disposed.
        page.evaluate('window.previousCanvas=document.querySelector("[data-day-detail-map] [data-route-map-canvas]")')
        page.locator('[data-action=edit-day-departure-time]').tap()
        page.locator('[data-time-edit-input]').fill('08:05')
        page.locator('[data-time-edit-confirm]').tap()
        page.wait_for_function('document.querySelector("[data-day-detail-map] [data-route-map-canvas]")!==previousCanvas')
        assert page.evaluate('mapTools.getRouteMapInteractionHandle(previousCanvas)===null'), 'old Leaflet map still alive after patch'
        assert page.locator('[data-next-water]').count()==0
        assert page.locator('[data-profile-interactive] .profile-marker--race-start').count()==1
        assert page.locator('[data-profile-interactive] .profile-marker--race-finish').count()==1
        assert page.locator('[data-race-overlay] line').count()==0
        assert 'Genappe' in page.locator('[data-day-detail-timeline]').inner_text()
        assert 'Namur' in page.locator('[data-day-detail-timeline]').inner_text()
        # A named ascent can be converted, without erasing its source or summit.
        named=page.locator('[data-action=toggle-climb-profile][data-climb-id]').filter(has_text='Col du contrôle')
        named.tap()
        profile_id=named.get_attribute('aria-controls')
        mini=page.locator('#'+profile_id+' [data-climb-profile-interactive]')
        mini.evaluate('el=>el.scrollIntoView({block:"center"})')
        readout=page.locator('#'+profile_id+' [data-mini-profile-band]')
        before_height=readout.bounding_box()['height']
        box=mini.bounding_box()
        page.mouse.move(box['x']+box['width']*.5,box['y']+box['height']*.5)
        assert readout.locator('[data-profile-tooltip]').is_visible()
        assert readout.bounding_box()['y']>=box['y']+box['height']
        dot=mini.locator('[data-profile-cursor-dot]').bounding_box()
        assert abs(dot['width']-dot['height'])<1 and dot['width']<14,dot
        assert abs(readout.bounding_box()['height']-before_height)<1
        page.mouse.move(1,1)
        original=page.evaluate('async id=>(await repository.loadTripBundle(id)).climbs', trip_id)
        page.locator('#'+profile_id+' [data-action=convert-climb]').tap()
        revert=page.locator('[data-action=revert-climb-segment]')
        revert.wait_for()
        assert named.count()==0
        assert page.locator('[data-day-detail-map] .route-marker--col-summit[aria-label="Col du contrôle"]').count()==1, page.evaluate('''async id=>{
          const {buildDayDetail}=await import(sourceRoot+'ui/trips/day-detail-view.ts');const b=await repository.loadTripBundle(id),d=buildDayDetail(b,b.days[0].id);
          return {visual:d.visualWaypoints.map(p=>({kind:p.kind,name:p.name,climbId:p.climbId,segmentId:p.raceSegmentId})),labels:[...document.querySelectorAll('[data-day-detail-map] .route-marker')].map(el=>el.getAttribute('aria-label'))};
        }''',trip_id)
        assert page.evaluate('async id=>(await repository.loadTripBundle(id)).climbs',trip_id)==original
        page.screenshot(path=str(output/(mode+'-conversion.png')))
        revert.tap()
        named.wait_for()
        assert named.get_attribute('aria-expanded')=='true'
        assert page.locator('[data-route-climb-profile] [data-profile-climb]').count()>0
        # Reflow after hidden tabs/patches must fit the entire compact route.
        for width in [320,390,1080]:
            page.set_viewport_size({'width':width,'height':844})
            mini=page.locator('[data-climb-id][aria-expanded=true]').locator('xpath=following-sibling::*[1]').locator('[data-climb-profile-interactive]')
            mini.evaluate('el=>el.scrollIntoView({block:"center"})')
            box=mini.bounding_box()
            page.mouse.move(box['x']+box['width']*.6,box['y']+box['height']*.5)
            dot=mini.locator('[data-profile-cursor-dot]').bounding_box()
            assert abs(dot['width']-dot['height'])<1 and dot['width']<14,(width,dot)
            page.mouse.move(1,1)
            page.locator('[data-day-tab=weather]').tap()
            page.set_viewport_size({'width':width,'height':844})
            page.locator('[data-day-tab=route]').tap()
            page.wait_for_function("""()=>{
              const c=document.querySelector('[data-day-detail-map] [data-route-map-canvas]'),p=c?.querySelector('.leaflet-overlay-pane path');
              if(!c||!p)return false;
              const a=c.getBoundingClientRect(),b=p.getBoundingClientRect();
              return a.width>0&&b.left>=a.left-2&&b.right<=a.right+2&&b.top>=a.top-2&&b.bottom<=a.bottom+2;
            }""")
            assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
        page.set_viewport_size({'width':390,'height':844})
        page.locator('[data-day-detail-profile]').evaluate('el=>el.scrollIntoView({block:"center"})')
        page.screenshot(path=str(output/(mode+'-profil.png')))
        page.evaluate('window.clockNow+=8*3600000;document.dispatchEvent(new Event("visibilitychange"))')
        assert '8 h' in page.locator('[data-day-detail-weather-alerts] [data-weather-age]').inner_text()
        assert page.locator('[data-day-detail-weather-alerts] [data-weather-age]').is_visible()
        page.locator('[data-day-detail-weather-alerts]').scroll_into_view_if_needed()
        page.wait_for_timeout(350)  # Let the native tap highlight finish for the image.
        page.screenshot(path=str(output/(mode+'-eau-meteo.png')))
        page.locator('[data-day-detail] [data-day-tab=weather]').tap()
        page.locator('#day-bottom-panel-weather [data-weather-age]').scroll_into_view_if_needed()
        page.screenshot(path=str(output/(mode+'-meteo-ancienne.png')))
        page.locator('[data-day-detail] [data-day-tab=route]').tap()
        # A compact marker remains an expand target, not a trapped popup.
        page.locator('[data-day-detail-map] .route-marker--race-climb').tap()
        dialog=page.locator('[data-day-detail-map-dialog][open]')
        dialog.wait_for()
        assert dialog.locator('[data-map-layers-toggle], [data-map-layers-panel]').count()==0
        dialog.locator('.route-marker--race-climb').tap()
        popup=dialog.locator('[data-route-feature-popup]')
        popup.wait_for()
        assert '3,0 km' in popup.inner_text() and 'D+' in popup.inner_text()
        assert dialog.locator('.leaflet-tooltip:visible').count()==0, 'the name tooltip duplicates the feature popup'
        assert dialog.locator('.leaflet-popup-close-button').bounding_box()['width']>=44
        page.wait_for_function('Number(getComputedStyle(document.querySelector(".leaflet-popup")).opacity) >= .95')
        page.screenshot(path=str(output/(mode+'-segment-carte.png')))
        dialog.locator('.leaflet-popup-close-button').tap()
        # Popup autopan may have moved the distant second climb out of view.
        dialog.locator('[data-close-map]').tap()
        page.locator('[data-day-detail-map]').tap()
        dialog.wait_for()
        page.keyboard.press('Escape')
        dialog.wait_for(state='hidden')
        assert page.evaluate('!document.body.classList.contains("map-scroll-locked")'), 'native dismissal left the document locked'
        page.locator('[data-day-detail-map]').tap()
        dialog.wait_for()
        dialog.locator('.route-marker--col-summit').first.wait_for()
        dialog.locator('.route-marker--col-summit').first.tap()
        dialog.locator('[data-route-feature-popup]').wait_for()
        assert 'Montée' in dialog.locator('[data-route-feature-popup]').inner_text()
        for width in [320,390,430]:
            dialog.locator('[data-close-map]').tap()
            page.set_viewport_size({'width':width,'height':844})
            page.locator('[data-day-detail-map]').tap()
            dialog.wait_for()
            dialog.locator('.route-marker--col-summit').first.tap()
            page.wait_for_function('''()=>{
              const r=document.querySelector('.route-feature-leaflet-popup')?.getBoundingClientRect();
              return r && r.left>=0 && r.right<=innerWidth;
            }''')
            assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
        page.set_viewport_size({'width':390,'height':844})
        dialog.locator('.leaflet-control-zoom-in').tap()
        page.evaluate('''async()=>{
          await new Promise(requestAnimationFrame);
          document.querySelector('[data-day-detail-map-dialog] [data-close-map]').click();
        }''')
    # Voyage keeps service layers; those popups also replace their name labels.
    page.evaluate('''async id=>repository.updateTripBundle(id,b=>({...b,settings:{...b.settings,global:{...b.settings.global,organizationMode:'voyage',raceMode:false}}}))''', trip_id)
    page.evaluate('manager.goToList()')
    page.locator('.trip-card').filter(has_text='Informations tour').wait_for()
    assert page.locator('.trip-card').filter(has_text='Informations tour').locator('[data-trip-mode]').inner_text()=='Voyage'
    page.locator('.trip-card').filter(has_text='Informations tour').tap()
    page.evaluate('manager.goToDetailForActiveTrip()')
    page.locator('[data-action=open-day-detail]').first.tap()
    page.locator('[data-day-detail-map]').tap()
    dialog=page.locator('[data-day-detail-map-dialog][open]')
    dialog.locator('[data-map-layers-toggle]').tap()
    dialog.locator('[data-map-layer=practical-water]').check()
    page.go_back()
    assert dialog.is_visible(), 'Back should close the layer panel before the map'
    assert dialog.locator('[data-map-layers-panel]').is_hidden()
    dialog.locator('.route-marker--practical-water').first.tap()
    dialog.locator('.practical-popup').wait_for()
    assert dialog.locator('.leaflet-tooltip:visible').count()==0
    page.go_back()
    assert dialog.is_visible()
    dialog.locator('.practical-popup').wait_for(state='detached')
    page.go_back()
    dialog.wait_for(state='hidden')
    assert page.evaluate('!document.body.classList.contains("map-scroll-locked")')
    page.locator('[data-day-detail-map]').tap()
    dialog.wait_for()
    dialog.evaluate('el=>el.close()')
    page.wait_for_function('!document.body.classList.contains("map-scroll-locked")')
    # An unavailable original produces an explicit error and no phantom download.
    saved=page.evaluate('''async id=>{
      const {OBJECT_STORE_NAMES}=await import(sourceRoot+'storage/indexeddb/constants.ts');
      const b=await repository.loadTripBundle(id),source=b.sourceFiles[0];
      await new Promise((resolve,reject)=>{const tx=database.transaction(OBJECT_STORE_NAMES.sourceFilePayloads,'readwrite');tx.objectStore(OBJECT_STORE_NAMES.sourceFilePayloads).delete([id,source.id]);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)});
      return source.id;
    }''', trip_id)
    downloads=[]
    page.on('download', lambda download: downloads.append(download))
    page.locator('[data-action=download-stage-gpx]').tap()
    status=page.locator('[data-original-export-status]')
    page.wait_for_function('document.querySelector("[data-original-export-status]")?.getAttribute("role")==="alert"')
    assert 'GPX d’origine indisponible' in status.inner_text() and not downloads
    assert page.locator('[data-action=download-stage-gpx]').is_enabled()
    page.evaluate('''async input=>{
      const b=await repository.loadTripBundle(input.id);
      await repository.saveTripBundle(b,{sourcePayloads:[{sourceFileId:input.source,content:new TextEncoder().encode(input.gpx).buffer}]});
    }''', {'id':trip_id,'source':saved,'gpx':gpx.decode()})
    with page.expect_download() as original:
        page.locator('[data-action=download-stage-gpx]').tap()
    assert Path(original.value.path()).read_bytes()==gpx
    # A transient read failure must be visible and recoverable with the same saved trip.
    page.evaluate('async()=>{window.failLocalRead=true;await manager.refresh()}')
    page.locator('[data-screen-load-error]').wait_for()
    page.evaluate('window.failLocalRead=false')
    page.locator('[data-action=retry-screen]').tap()
    page.locator('[data-day-detail-profile]').wait_for()
    assert page.locator('[data-screen-load-error]').count()==0
    assert not errors, errors
    print(json.dumps({'singleFeatureSheet':True,'oldMapDisposedAfterPatch':True,'nativeDismissalUnlocks':True,'voyageServicesPreserved':True,'missingOriginalExplicit':True,'originalRetryExact':True,'readFailureRetry':True}))
    print(json.dumps({'modes':['league','tour'],'conversionUndo':True,'namedSummitRetained':True,'compactRouteFits':True,'miniReadoutStableAndRound':True,'waterShortcutRemoved':True,'weatherAge8h':True,'noCompetitionLayers':True,'segmentAndClimbPopups':True,'widths':[320,390,430],'jsErrors':errors}))
    print('Artifacts:',output)
    browser.close()
