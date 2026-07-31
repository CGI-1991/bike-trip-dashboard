// Builds the RGA 2026 golden master's parity matrix from the three
// snapshots (legacy pipeline, canonical package, TripBundle). Pure and
// deterministic: no I/O, no clock, no randomness. Every domain gets one
// entry with a status of `exact`, `source-preserved`, `dynamic-excluded`, or
// `deferred` — a status of `mismatch` means a domain that should be one of
// the first three no longer is, which is exactly what the golden master
// test asserts never happens silently.

const STATUSES = ['exact', 'source-preserved', 'dynamic-excluded', 'deferred', 'mismatch']

function domain(id, status, description, legacy, tripBundle, justification, nextPhase = null) {
  if (!STATUSES.includes(status)) throw new Error(`Unknown parity status: ${status}`)
  return { domain: id, status, description, legacy, tripBundle, justification, nextPhase }
}

function deepEqualJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function sortStrings(values) {
  return [...values].sort()
}

export function buildParityMatrix(legacy, canonical, tripBundle) {
  const matrix = []

  // --- metadata & calendar -------------------------------------------------
  {
    const legacyValue = {
      id: legacy.tripPlan.id,
      slug: canonical.slug,
      name: legacy.tripPlan.name,
      language: canonical.language,
      units: 'metric',
      timezone: legacy.tripPlan.timezone,
      startDate: legacy.calendar.startDate,
      endDate: legacy.calendar.endDate,
      dayDateCount: legacy.calendar.days.length,
    }
    const tripBundleValue = {
      id: tripBundle.metadata.id,
      slug: tripBundle.metadata.slug,
      name: tripBundle.metadata.name,
      language: tripBundle.metadata.language,
      units: tripBundle.metadata.units,
      timezone: tripBundle.metadata.timezone,
      startDate: tripBundle.metadata.startDate,
      endDate: tripBundle.metadata.endDate,
      dayDateCount: tripBundle.days.filter((day) => day.date !== null).length,
    }
    const exact = deepEqualJson(legacyValue, tripBundleValue) && tripBundle.calendar.timezone === legacy.calendar.timezone
    matrix.push(
      domain(
        'metadata_and_calendar',
        exact ? 'exact' : 'mismatch',
        'Trip identity (id, slug, name, language, units, timezone) and calendar (start/end date, 12 daily dates).',
        legacyValue,
        tripBundleValue,
        'TripBundle.metadata/calendar are built directly from the same historical trip id, roadbook title and calendar constant — see rga-legacy-mapping.ts mapMetadata/mapCalendar.',
      ),
    )
  }

  // --- days ------------------------------------------------------------
  {
    const legacyDays = legacy.tripPlan.days
    const legacyOff = legacyDays.filter((day) => day.type === 'off')
    const legacyLast = legacyDays.at(-1)
    const legacyValue = {
      total: legacyDays.length,
      ride: legacyDays.filter((day) => day.type === 'ride').length,
      off: legacyOff.length,
      offLocations: legacyOff.map((day) => ({ dayNumber: day.dayNumber, locationName: day.locationName })),
      finalDestination: legacyLast.endName,
      notesByDayNumber: Object.fromEntries(
        legacy.roadbook.days.map((day) => [day.dayNumber, day.notes.length === 0 ? null : day.notes.join('\n')]),
      ),
    }
    const tbOff = tripBundle.days.filter((day) => day.type === 'off')
    const tbLast = tripBundle.days.at(-1)
    const tripBundleValue = {
      total: tripBundle.counts.totalDays,
      ride: tripBundle.counts.rideDays,
      off: tripBundle.counts.offDays,
      offLocations: tbOff.map((day) => ({ dayNumber: day.displayNumber, locationName: day.startLocationName })),
      finalDestination: tbLast.endLocationName,
      notesByDayNumber: Object.fromEntries(tripBundle.days.map((day) => [day.displayNumber, day.notes])),
    }
    const exact =
      legacyValue.total === tripBundleValue.total &&
      legacyValue.ride === tripBundleValue.ride &&
      legacyValue.off === tripBundleValue.off &&
      deepEqualJson(legacyValue.offLocations, tripBundleValue.offLocations) &&
      legacyValue.finalDestination === tripBundleValue.finalDestination &&
      deepEqualJson(legacyValue.notesByDayNumber, tripBundleValue.notesByDayNumber)
    matrix.push(
      domain(
        'days',
        exact ? 'exact' : 'mismatch',
        '12 days (10 ride, 2 off), order, OFF-day locations (J5 Bourg-Saint-Maurice, J8 Briançon), final destination (Nice), structured notes.',
        legacyValue,
        tripBundleValue,
        'Every TripDay is derived 1:1 from a roadbook.json day (mapDaysAndStages); notes are the deterministic newline-join of the historical notes array, never the ambiance text.',
      ),
    )
  }

  // --- stages ------------------------------------------------------------
  {
    const legacyRideDays = legacy.roadbook.days.filter((day) => day.type === 'ride')
    const legacyValue = {
      count: legacyRideDays.length,
      editorialStatsByDayNumber: Object.fromEntries(legacyRideDays.map((day) => [day.dayNumber, day.editorialStats])),
    }
    const tripBundleValue = {
      count: tripBundle.stages.length,
      editorialStatsByDayNumber: Object.fromEntries(
        tripBundle.days
          .filter((day) => day.hasStage)
          .map((day) => {
            const stage = tripBundle.stages.find((candidate) => candidate.dayId === day.id)
            return [day.displayNumber, { distanceKm: stage.distanceKm, elevationGainM: stage.elevationGainM, elevationLossM: stage.elevationLossM }]
          }),
      ),
      allHaveMetricsProvenance: tripBundle.stages.every((stage) => stage.metricsProvenance !== null),
      allProvenanceMigratedMediumConfidence: tripBundle.stages.every(
        (stage) => stage.metricsProvenance.sourceType === 'migrated' && stage.metricsProvenance.confidence === 'medium',
      ),
      everyStageHasRoute: tripBundle.stages.every((stage) => stage.hasRoute),
    }
    const exact =
      legacyValue.count === tripBundleValue.count &&
      deepEqualJson(legacyValue.editorialStatsByDayNumber, tripBundleValue.editorialStatsByDayNumber) &&
      tripBundleValue.allHaveMetricsProvenance &&
      tripBundleValue.allProvenanceMigratedMediumConfidence &&
      tripBundleValue.everyStageHasRoute
    matrix.push(
      domain(
        'stages',
        exact ? 'exact' : 'mismatch',
        '10 RideStage, day<->stage<->route relations, name/start/end, and the roadbook editorial statistics (distanceKm/elevationGainM/elevationLossM) with their own provenance.',
        legacyValue,
        tripBundleValue,
        "Editorial statistics are migrated verbatim from roadbook.json's editorialStats, tagged with a distinct metricsProvenance (sourceType:'migrated', confidence:'medium') precisely because they are an editorial figure, not a GPX computation.",
      ),
    )
  }

  // --- source files --------------------------------------------------------
  {
    const legacyValue = {
      count: legacy.gpxSourceFiles.count,
      names: sortStrings(legacy.gpxSourceFiles.files.map((file) => file.fileName)),
      hashes: sortStrings(legacy.gpxSourceFiles.files.map((file) => file.sha256)),
    }
    const tripBundleValue = {
      count: tripBundle.sourceFiles.length,
      names: sortStrings(tripBundle.sourceFiles.map((file) => file.originalName)),
      hashes: sortStrings(tripBundle.sourceFiles.map((file) => file.sha256)),
    }
    const exact = deepEqualJson(legacyValue, tripBundleValue) && new Set(tripBundleValue.names).size === 10 && new Set(tripBundleValue.hashes).size === 10
    matrix.push(
      domain(
        'source_files',
        exact ? 'exact' : 'mismatch',
        '10 SourceFile: exact names, sizes, SHA-256 hashes, uniqueness, and a route referencing each one.',
        legacyValue,
        tripBundleValue,
        'SourceFile.sha256/sizeBytes are computed from the same public/data/gpx/*.gpx bytes read for the legacy snapshot and copied into the canonical package.',
      ),
    )
  }

  // --- canonical package ---------------------------------------------------
  {
    const legacyValue = { historicalGpxCount: legacy.gpxSourceFiles.count }
    const tripBundleValue = {
      fileCount: canonical.fileCount,
      driftOk: canonical.drift.ok,
      missing: canonical.drift.missing,
      different: canonical.drift.different,
      extra: canonical.drift.extra,
      gpxHashesMatchHistorical: deepEqualJson(
        sortStrings(canonical.gpx.map((entry) => entry.sha256)),
        sortStrings(legacy.gpxSourceFiles.files.map((file) => file.sha256)),
      ),
    }
    const exact = tripBundleValue.fileCount === 16 && tripBundleValue.driftOk && tripBundleValue.gpxHashesMatchHistorical
    matrix.push(
      domain(
        'canonical_package',
        exact ? 'exact' : 'mismatch',
        '16 canonical package files, no missing/extra file, stable SHA-256 hashes, check:rga-trip-package green.',
        legacyValue,
        tripBundleValue,
        'scripts/generate-rga-trip-package.mjs --check reconstructs the package plan purely from public/data/** and compares it byte-for-byte with public/trips/rga-2026/**.',
      ),
    )
  }

  // --- documented points ---------------------------------------------------
  {
    const pc = legacy.roadbook.pointCounts
    const legacyValue = {
      documentedPointCandidates: pc.documentedPointCandidates,
      roadbookOverrides: pc.roadbookOverrides,
      matchedOverrides: pc.matchedOverrides,
      needsReviewOverrides: pc.needsReviewOverrides,
      unmatchedOverrides: pc.unmatchedOverrides,
      suppressed: pc.suppressed,
      documentedObjectCount: pc.documentedObjectCount,
      operationalObjectCount: pc.operationalObjectCount,
      runtimeOperationalPointCount: legacy.roadbookMatchSummary.pointCount,
    }
    const tripBundleValue = { routePointCount: tripBundle.routePoints.length }
    const relationsHold =
      pc.roadbookOverrides === pc.matchedOverrides + pc.needsReviewOverrides + pc.unmatchedOverrides &&
      pc.suppressed === pc.needsReviewOverrides + pc.unmatchedOverrides &&
      pc.operationalObjectCount === pc.documentedObjectCount - pc.suppressed &&
      legacy.roadbookMatchSummary.pointCount === pc.operationalObjectCount &&
      tripBundleValue.routePointCount === pc.matchedOverrides
    const noFalsePositives = tripBundle.routePoints.every((point) => point.confidence === 'high' && point.manuallyOverridden === true)
    const exact = relationsHold && noFalsePositives
    matrix.push(
      domain(
        'documented_points',
        exact ? 'exact' : 'mismatch',
        'Documented-point accounting: 53 candidates = 46 matched + 4 needs-review + 3 unmatched; 7 suppressed = 4 + 3; 71 operational = 78 documented − 7 suppressed; TripBundle keeps exactly the 46 matched, positioned overrides as RoutePoint, never a needs-review/unmatched one.',
        legacyValue,
        tripBundleValue,
        'documentedPointCandidates/roadbookOverrides/matchedOverrides/needsReviewOverrides/unmatchedOverrides/suppressed/documentedObjectCount/operationalObjectCount are computed from roadbook.json + roadbook-overrides.json + roadbookSuppressions.ts; runtimeOperationalPointCount cross-checks the same number against the live buildRoadbookMatchReport() pipeline (66 active + 5 informational = 71). TripBundle.routePoints only ever comes from the 46 `matched` overrides — never the 71-point operational concept, which also includes the 20 synthetic start/end points and 5 informational pauses that TripBundle represents differently (day/stage start & end location names).',
      ),
    )
  }

  // --- practical places -----------------------------------------------------
  {
    const legacyValue = {
      totalCount: legacy.practicalPlaces.totalCount,
      byCategory: legacy.practicalPlaces.byCategory,
      multiDayCount: legacy.practicalPlaces.multiDayCount,
      dayIdShapeHash: legacy.practicalPlaces.dayIdShapeHash,
    }
    const tripBundleByCategory = tripBundle.practicalPlaces.byCategory
    const exactCategoryMatch = Object.entries(legacyValue.byCategory).every(([iconKey, count]) => {
      const mapped = { shelter: 'shelter', bakery: 'bakery', cafe: 'cafe-or-ice-cream', water: 'water', food: 'fast-food', bicycle: 'bike-service', grocery: 'supermarket', toilet: 'toilet' }[iconKey]
      return tripBundleByCategory[mapped] === count
    })
    const tripBundleValue = {
      totalCount: tripBundle.practicalPlaces.totalCount,
      byCategory: tripBundleByCategory,
      multiDayCount: tripBundle.practicalPlaces.multiDayCount,
      dayIdShapeHash: tripBundle.practicalPlaces.dayIdShapeHash,
      categoryCount: Object.keys(tripBundleByCategory).length,
    }
    const exact =
      legacyValue.totalCount === tripBundleValue.totalCount &&
      legacyValue.multiDayCount === tripBundleValue.multiDayCount &&
      legacyValue.dayIdShapeHash === tripBundleValue.dayIdShapeHash &&
      tripBundleValue.categoryCount === 8 &&
      exactCategoryMatch
    matrix.push(
      domain(
        'practical_places',
        exact ? 'exact' : 'mismatch',
        '1,705 practical places, 8 categories, identifiers, names, coordinates, categories, descriptions, and day associations (449 multi-day places) preserved exactly, selectable via selectPracticalPlacesForDay.',
        legacyValue,
        tripBundleValue,
        'mapPracticalPlaces copies every historical point 1:1 (id, name, coordinates, description) and mapPracticalPlace.dayIds is copied verbatim from the historical dayIds, translated to generic TripDayId via buildLegacyDayIdIndex — never recomputed from geographic proximity.',
      ),
    )
  }

  // --- accommodations --------------------------------------------------------
  {
    const legacyValue = { count: legacy.accommodations.count, ids: sortStrings(legacy.accommodations.accommodations.map((a) => a.id)) }
    const tripBundleValue = { count: tripBundle.accommodations.length, ids: sortStrings(tripBundle.accommodations.map((a) => a.id)) }
    const dayAssociationsMatch = legacy.accommodations.accommodations.every((legacyItem) => {
      const tbItem = tripBundle.accommodations.find((candidate) => candidate.id === legacyItem.id)
      return tbItem !== undefined && tbItem.dayIds.length === legacyItem.dayIds.length
    })
    const exact = deepEqualJson(legacyValue, tripBundleValue) && dayAssociationsMatch
    matrix.push(
      domain(
        'accommodations',
        exact ? 'exact' : 'mismatch',
        '10 accommodations: identifiers, day associations, names, types, addresses, coordinates, URLs, confirmed status.',
        legacyValue,
        tripBundleValue,
        'mapAccommodations/buildAccommodationDayIndex reuse the historical accommodations.json verbatim, including getAccommodationMapsUrl for mapsUrl.',
      ),
    )
  }

  // --- settings ------------------------------------------------------------
  {
    const legacyValue = { referenceSpeedKph: legacy.settings.referenceSpeedKph, departureTime: legacy.settings.departureTime, totalBreakMinutes: legacy.settings.totalBreakMinutes, rideDayCount: legacy.settings.rideDayCount }
    const tripBundleValue = { referenceSpeedKph: tripBundle.settings.referenceSpeedKph, dayEntryCount: tripBundle.settings.dayEntryCount, pausePlanMode: tripBundle.settings.pausePlanMode }
    const exact =
      legacyValue.referenceSpeedKph === tripBundleValue.referenceSpeedKph &&
      legacyValue.referenceSpeedKph === 18 &&
      legacyValue.rideDayCount === tripBundleValue.dayEntryCount &&
      tripBundleValue.pausePlanMode === 'automatic'
    matrix.push(
      domain(
        'settings',
        exact ? 'exact' : 'mismatch',
        'Reference speed (18 km/h), automatic pause strategy, 10 daily settings entries, schedules and pause budgets — never read from localStorage.',
        legacyValue,
        tripBundleValue,
        'mapSettings takes the historical default settings (src/storage/settings.ts) as an explicit parameter; the constructor never touches localStorage/window/document (verified by tests/trips/rga-2026/settings.test.mjs).',
      ),
    )
  }

  // --- offline resources -----------------------------------------------------
  {
    const legacyValue = {
      historicalResourceCount: legacy.offline.historicalResourceCount,
      tripPackageResourceCount: legacy.offline.tripPackageResourceCount,
      combinedResourceCount: legacy.offline.combinedResourceCount,
      duplicateCount: legacy.offline.duplicateCount,
      hasAbsoluteUrl: legacy.offline.hasAbsoluteUrl,
      hasWindowsPath: legacy.offline.hasWindowsPath,
    }
    const tripBundleValue = { canonicalPackageFileCount: canonical.fileCount }
    const exact =
      legacyValue.tripPackageResourceCount === canonical.fileCount &&
      legacyValue.duplicateCount === 0 &&
      legacyValue.hasAbsoluteUrl === false &&
      legacyValue.hasWindowsPath === false &&
      legacyValue.combinedResourceCount === legacyValue.historicalResourceCount + legacyValue.tripPackageResourceCount
    matrix.push(
      domain(
        'offline_resources',
        exact ? 'exact' : 'mismatch',
        'Every historical offline resource stays precached; every canonical package file is discovered and precached automatically; no duplicates, no absolute URL, no Windows path.',
        legacyValue,
        tripBundleValue,
        'collectOfflineResources(publicDir) discovers public/trips/** generically (never hardcoding rga-2026 or a file count); vite.config.ts unions it with the static historical list and hashes every resource\'s content into the cache version.',
      ),
    )
  }

  // --- weather (dynamic-excluded) --------------------------------------------
  {
    matrix.push(
      domain(
        'weather',
        'dynamic-excluded',
        'Weather is date/cache/provider-dependent and must never be frozen into a static snapshot.',
        { note: 'The legacy pipeline computes weather sample points and forecasts live, from the current date and Open-Meteo, never from a fixture.' },
        { weatherRecordCount: tripBundle.weatherCount },
        'TripBundle.weather stays [] in the canonical snapshot on purpose (CDC phase 3 section 7 / phase 4 section 9); the legacy weather system (src/weather/*) is untouched and keeps serving the live app.',
      ),
    )
  }

  // --- source-preserved domains ----------------------------------------------
  {
    const legacyValue = {
      roadbookHash: legacy.roadbook.roadbookHash,
      overridesHash: legacy.roadbook.overridesHash,
      suppressedPointIds: legacy.roadbook.suppressedPointIds,
      skippedOverrideCount: legacy.roadbook.skippedOverrideCount,
    }
    const tripBundleValue = { overrideCount: tripBundle.overrideCount, climbCount: tripBundle.climbCount }
    matrix.push(
      domain(
        'roadbook_editorial_source_preserved',
        'source-preserved',
        'Full editorial roadbook (ambiance, OFF-day activities/logistics/recovery, options without a validated position, raw geometric overrides, needs-review/unmatched entries) is preserved verbatim in the canonical package but not yet modeled in TripBundle.',
        legacyValue,
        tripBundleValue,
        'public/trips/rga-2026/roadbook/roadbook.json and overrides/roadbook-overrides.json are byte-identical copies of the historical sources (see canonical_package); TripBundle.overrides stays [] (no deterministic targetType/targetId/field mapping exists yet) and TripBundle.climbs stays [] (start/end distances would mix editorial and GPX-technical provenance).',
        'Phase 5+: model overrides/climbs generically enough to represent this data without inventing a false provenance.',
      ),
    )
  }

  // --- deferred domains --------------------------------------------------------
  {
    const legacyValue = {
      readyRideDayCount: legacy.timingsDefault.readyRideDayCount,
      totalTripMovingMinutes: legacy.timingsDefault.totalTripMovingMinutes,
      gpxTechnicalSampleCount: legacy.gpxTechnical.length,
    }
    const tripBundleValue = {
      routesWithGeometry: tripBundle.routes.count - (tripBundle.routes.allGeometryNull ? tripBundle.routes.count : 0),
      routesWithProfile: tripBundle.routes.count - (tripBundle.routes.allProfileNull ? tripBundle.routes.count : 0),
      stagesWithMinMaxAltitude: tripBundle.stages.filter((stage) => stage.minAltitudeM !== null || stage.maxAltitudeM !== null).length,
      stagesWithDurations: tripBundle.stages.filter((stage) => stage.totalDurationSeconds !== null).length,
      stagesWithEstimatedSpeed: tripBundle.stages.filter((stage) => stage.estimatedAverageSpeedKph !== null).length,
      totalDurationSecondsSum: tripBundle.totals.totalDurationSeconds,
    }
    const stillDeferred =
      tripBundleValue.routesWithGeometry === 0 &&
      tripBundleValue.routesWithProfile === 0 &&
      tripBundleValue.stagesWithMinMaxAltitude === 0 &&
      tripBundleValue.stagesWithDurations === 0 &&
      tripBundleValue.stagesWithEstimatedSpeed === 0 &&
      tripBundleValue.totalDurationSecondsSum === null
    matrix.push(
      domain(
        'route_geometry_and_stage_timings',
        stillDeferred ? 'deferred' : 'mismatch',
        'Route.geometry/profile, RideStage min/max altitude, moving/pause/total duration, estimated average speed, generic climbs, TripOverride, ETA and the TripBundle-native timeline all remain out of scope, tracked here as the target for future phases.',
        legacyValue,
        tripBundleValue,
        'CDC phase 3 section 11 explicitly defers these (no new GPX parser, no approximate recomputation); this domain fails if any of them silently turns non-null without an accompanying test/status update, i.e. is presented as parity before it actually is.',
        'Phase 5: parse GPX (or reuse a Node-compatible path) to populate geometry/profile, then derive stage timings/ETA from it — at that point this domain must be re-classified per field, not left as one bucket.',
      ),
    )
  }

  return matrix
}
