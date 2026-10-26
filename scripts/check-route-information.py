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
    page.route('**/__route_information', lambda route: route.fulfill(content_type='text/html', body=f'<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="{args.url}src/style.css"><link rel="stylesheet" href="{args.url}src/ui/tripplus.css"><div class="app-shell"><main class="dashboard"><div id="host"></div></main></div>'))
    page.goto(args.url+'__route_information')
    page.wait_for_load_state('networkidle')
    page.evaluate('''async root => {
      window.sourceRoot=root+'src/';
      const base=sourceRoot;
      const {openBikeTripDatabase}=await import(base+'storage/indexeddb/open-database.ts');
      const {createTripRepository}=await import(base+'storage/indexeddb/trip-repository.ts');
      const {initializeTripsManager}=await import(base+'ui/trips/trips-manager.ts');
      const map=await import(base+'ui/route-map.ts');
      window.database=await openBikeTripDatabase(indexedDB);
      window.repository=createTripRepository(database);
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
      window.manager=initializeTripsManager(document.querySelector('#host'),{database,now,idFactory:()=> 'information-'+serial++,weatherProvider:provider,
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
        water=page.locator('[data-next-water]')
        assert water.is_visible()
        assert water.locator('strong').inner_text()=='Fontaine de la place'
        assert 'Dans 6,0 km' in water.inner_text()
        assert 'Passage —' not in water.inner_text()
        page.locator('[data-day-detail-profile]').evaluate('el=>el.scrollIntoView({block:"start"})')
        plot=page.locator('[data-day-detail-profile] [data-profile-interactive]')
        box=plot.bounding_box()
        before=page.locator('.course-exports').bounding_box()['y']
        calls=page.evaluate('weatherCalls')
        page.mouse.move(box['x']+box['width']*(20+760*10/length)/800,box['y']+box['height']*.6)
        assert water.locator('strong').inner_text()=='Fontaine du second col'
        assert 'Dans 14,0 km' in water.inner_text()
        assert abs(page.locator('.course-exports').bounding_box()['y']-before)<1
        page.mouse.move(1,1)
        assert water.locator('strong').inner_text()=='Fontaine de la place'
        assert page.evaluate('weatherCalls')==calls
        page.evaluate('document.querySelector(".next-water__point").addEventListener("click",e=>{e.preventDefault();window.waterLinkClicked=true})')
        water.locator('a').tap()
        assert page.evaluate('window.waterLinkClicked')
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
        assert dialog.locator('.leaflet-popup-close-button').bounding_box()['width']>=44
        page.wait_for_function('Number(getComputedStyle(document.querySelector(".leaflet-popup")).opacity) >= .95')
        page.screenshot(path=str(output/(mode+'-segment-carte.png')))
        dialog.locator('.leaflet-popup-close-button').tap()
        # Popup autopan may have moved the distant second climb out of view.
        dialog.locator('[data-close-map]').tap()
        page.locator('[data-day-detail-map]').tap()
        dialog.wait_for()
        assert dialog.locator('.route-marker--col-summit').count()>0
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
    assert not errors, errors
    print(json.dumps({'modes':['league','tour'],'waterPotabilityAccessOpening':True,'sharedPassageEta':True,'noExtraWeatherCalls':True,'stableWaterHeight':True,'weatherAge8h':True,'noCompetitionLayers':True,'segmentAndClimbPopups':True,'widths':[320,390,430],'jsErrors':errors}))
    print('Artifacts:',output)
    browser.close()
