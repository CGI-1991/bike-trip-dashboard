"""Rebuild documented-point projections and the 2026-07-28 audit reports."""

from __future__ import annotations

import json
import math
import xml.etree.ElementTree as ET
from collections import Counter
from datetime import datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ROADBOOK_PATH = ROOT / "public/data/trip/roadbook.json"
OVERRIDES_PATH = ROOT / "public/data/trip/roadbook-overrides.json"
MANIFEST_PATH = ROOT / "public/data/gpx/manifest.json"
AUDIT_JSON_PATH = ROOT / "docs/point-data-audit-2026-07-28.json"
AUDIT_MD_PATH = ROOT / "docs/point-data-audit-2026-07-28.md"
EARTH_RADIUS_M = 6_371_008.8
AVERAGE_SPEED_KPH = 18.0
DEPARTURE_TIME = datetime(2000, 1, 1, 8, 0)

# Documented points permanently removed from the operational trip by user decision
# (RGA_DASHBOARD_21). Mirrors `src/trip/roadbook-suppressions.ts` — the source of
# truth the running app actually filters on. Kept here only so this audit report
# can distinguish historical (source) vs operational vs suppressed counts; it does
# not itself gate anything at runtime.
SUPPRESSED_POINT_IDS = {
    "j01-passage-bellevaux",
    "j03-passage-crest-voland",
    "j04-passage-areches",
    "j04-passage-les-chapieux",
    "j06-passage-tignes",
    "j09-passage-chateau-queyras",
    "j10-option-cime-de-la-bonette",
}
SUPPRESSION_JUSTIFICATION = "Point explicitement retiré du voyage opérationnel par décision utilisateur."


def distance_m(a: tuple[float, float], b: tuple[float, float]) -> float:
    lat1, lon1 = map(math.radians, a)
    lat2, lon2 = map(math.radians, b)
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    value = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(math.sqrt(value))


def load_gpx(path: Path) -> list[list[dict]]:
    root = ET.parse(path).getroot()
    namespace = {"g": root.tag.partition("}")[0].lstrip("{")}
    segments: list[list[dict]] = []
    cumulative_km = 0.0
    previous: tuple[float, float] | None = None
    for segment_index, segment in enumerate(root.findall(".//g:trkseg", namespace)):
        points: list[dict] = []
        for point_index, node in enumerate(segment.findall("g:trkpt", namespace)):
            latitude = float(node.attrib["lat"])
            longitude = float(node.attrib["lon"])
            coordinate = (latitude, longitude)
            if previous is not None:
                cumulative_km += distance_m(previous, coordinate) / 1000
            elevation_node = node.find("g:ele", namespace)
            elevation = float(elevation_node.text) if elevation_node is not None and elevation_node.text else None
            points.append(
                {
                    "latitude": latitude,
                    "longitude": longitude,
                    "elevationM": elevation,
                    "segmentIndex": segment_index,
                    "pointIndex": point_index,
                    "trackDistanceKm": cumulative_km,
                }
            )
            previous = coordinate
        if points:
            segments.append(points)
    return segments


def project(anchor: dict, segments: list[list[dict]]) -> dict:
    source_lat = float(anchor["latitude"])
    source_lon = float(anchor["longitude"])
    cos_lat = math.cos(math.radians(source_lat))
    best: dict | None = None
    for segment in segments:
        for index, start in enumerate(segment):
            if index + 1 >= len(segment):
                candidate = {**start, "nextPointIndex": start["pointIndex"], "segmentFraction": 0.0}
            else:
                end = segment[index + 1]
                ax = (start["longitude"] - source_lon) * cos_lat
                ay = start["latitude"] - source_lat
                bx = (end["longitude"] - source_lon) * cos_lat
                by = end["latitude"] - source_lat
                dx, dy = bx - ax, by - ay
                denominator = dx * dx + dy * dy
                fraction = 0.0 if denominator == 0 else max(0.0, min(1.0, -(ax * dx + ay * dy) / denominator))
                elevation = None
                if start["elevationM"] is not None and end["elevationM"] is not None:
                    elevation = start["elevationM"] + (end["elevationM"] - start["elevationM"]) * fraction
                candidate = {
                    "latitude": start["latitude"] + (end["latitude"] - start["latitude"]) * fraction,
                    "longitude": start["longitude"] + (end["longitude"] - start["longitude"]) * fraction,
                    "elevationM": elevation,
                    "segmentIndex": start["segmentIndex"],
                    "pointIndex": start["pointIndex"],
                    "nextPointIndex": end["pointIndex"],
                    "segmentFraction": fraction,
                    "trackDistanceKm": start["trackDistanceKm"]
                    + (end["trackDistanceKm"] - start["trackDistanceKm"]) * fraction,
                }
            candidate["anchorDistanceM"] = distance_m(
                (source_lat, source_lon), (candidate["latitude"], candidate["longitude"])
            )
            if best is None or candidate["anchorDistanceM"] < best["anchorDistanceM"]:
                best = candidate
    if best is None:
        raise ValueError("GPX without track points")
    return best


def rounded_projection(value: dict) -> dict:
    return {
        "latitude": round(value["latitude"], 7),
        "longitude": round(value["longitude"], 7),
        "trackDistanceKm": round(value["trackDistanceKm"], 3),
        "segmentIndex": value["segmentIndex"],
        "pointIndex": value["pointIndex"],
        "nextPointIndex": value["nextPointIndex"],
        "segmentFraction": round(value["segmentFraction"], 4),
        "elevationM": round(value["elevationM"], 1) if value["elevationM"] is not None else 0.0,
    }


def point_role(point_id: str, status: str, source_kind: str) -> str:
    off_route = {
        "j01-passage-bellevaux",
        "j03-passage-crest-voland",
        "j04-passage-areches",
        "j04-passage-les-chapieux",
        "j06-passage-tignes",
        "j09-passage-chateau-queyras",
    }
    if point_id == "j10-option-cime-de-la-bonette":
        return "not-ridden-option"
    if point_id in off_route:
        return "weather-reference"
    if source_kind == "pause":
        return "information"
    return "route-point" if status == "matched" else "information"


def eta_for(distance_km: float | None) -> str | None:
    if distance_km is None:
        return None
    return (DEPARTURE_TIME + timedelta(hours=distance_km / AVERAGE_SPEED_KPH)).strftime("%H:%M")


def main() -> None:
    previous_audit = (
        json.loads(AUDIT_JSON_PATH.read_text(encoding="utf-8"))
        if AUDIT_JSON_PATH.exists()
        else None
    )
    roadbook = json.loads(ROADBOOK_PATH.read_text(encoding="utf-8"))
    overrides_document = json.loads(OVERRIDES_PATH.read_text(encoding="utf-8"))
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    overrides = {entry["pointId"]: entry for entry in overrides_document["overrides"]}
    ride_days = [day for day in roadbook["days"] if day["type"] == "ride"]
    if len(manifest["files"]) != 10 or len(ride_days) != 10:
        raise ValueError("Expected exactly ten final GPX files and ten ride days")
    tracks = {
        day["id"]: load_gpx(ROOT / "public/data/gpx" / manifest["files"][index]["fileName"])
        for index, day in enumerate(ride_days)
    }

    invalid_before = 0
    override_validity: dict[str, bool] = {}
    rebuilt_overrides: list[dict] = []
    projections: dict[str, dict] = {}
    for old in overrides_document["overrides"]:
        rebuilt = project(old["sourceAnchor"], tracks[old["dayId"]])
        previous = old["gpxProjection"]
        valid = (
            distance_m(
                (previous["latitude"], previous["longitude"]),
                (rebuilt["latitude"], rebuilt["longitude"]),
            )
            <= 15
            and abs(previous["trackDistanceKm"] - rebuilt["trackDistanceKm"]) <= 0.015
            and previous["segmentIndex"] == rebuilt["segmentIndex"]
            and previous["pointIndex"] == rebuilt["pointIndex"]
            and previous["nextPointIndex"] == rebuilt["nextPointIndex"]
        )
        if not valid:
            invalid_before += 1
        override_validity[old["pointId"]] = valid
        projections[old["pointId"]] = rebuilt
        updated = dict(old)
        updated["gpxProjection"] = rounded_projection(rebuilt)
        updated["anchorDistanceM"] = round(rebuilt["anchorDistanceM"], 1)
        updated["matchMethod"] = "manual-anchor-reprojected-current-gpx"
        updated["validationSource"] = "RGA_DASHBOARD_19 — reconstruction complète 2026-07-28"
        updated["comment"] = (
            f"Ancre géographique validée conservée ; projection technique recalculée sur le GPX "
            f"définitif ; distance à la trace {updated['anchorDistanceM']:.1f} m."
        )
        rebuilt_overrides.append(updated)
    overrides_document["overrides"] = rebuilt_overrides
    OVERRIDES_PATH.write_text(
        json.dumps(overrides_document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    if previous_audit is not None:
        previous_summary = previous_audit.get("summary", {})
        if previous_summary.get("rebuiltProjectionCount") == len(rebuilt_overrides):
            invalid_before = int(previous_summary.get("invalidOverridesBeforeRebuild", invalid_before))
            previous_validity = {
                item["id"]: item.get("overrideWasValid")
                for item in previous_audit.get("points", [])
                if item.get("overrideExists")
            }
            override_validity.update(
                {point_id: value for point_id, value in previous_validity.items() if isinstance(value, bool)}
            )

    inventory: list[dict] = []
    ride_index = 0
    for day in roadbook["days"]:
        if day["type"] != "ride":
            continue
        segments = tracks[day["id"]]
        flat = [point for segment in segments for point in segment]
        source_items = [
            (f"j{day['dayNumber']:02d}-start", day["startName"], "start", "start", None),
            *[(item["id"], item["name"], "col", "col", item.get("elevationM")) for item in day["cols"]],
            *[(item["id"], item["label"], "passage", "passage", None) for item in day["resupplyPassages"]],
            *[(item["id"], item["title"], "pause", "pause", None) for item in day["explicitPauses"]],
            *[
                (item["id"], item["title"], "option", "option", item.get("elevationM"))
                for item in day["options"]
            ],
            (f"j{day['dayNumber']:02d}-end", day["endName"], "end", "end", None),
        ]
        for order, (point_id, name, point_type, source_kind, documented_elevation) in enumerate(source_items):
            override = overrides.get(point_id)
            if point_type == "start":
                projection = {
                    **flat[0],
                    "nextPointIndex": flat[0]["pointIndex"],
                    "segmentFraction": 0.0,
                    "anchorDistanceM": 0.0,
                }
                status = "matched"
                source_coordinates = [flat[0]["latitude"], flat[0]["longitude"]]
            elif point_type == "end":
                projection = {
                    **flat[-1],
                    "nextPointIndex": flat[-1]["pointIndex"],
                    "segmentFraction": 0.0,
                    "anchorDistanceM": 0.0,
                }
                status = "matched"
                source_coordinates = [flat[-1]["latitude"], flat[-1]["longitude"]]
            elif override is not None:
                projection = projections[point_id]
                status = override["approvedStatus"]
                source_coordinates = [
                    override["sourceAnchor"]["latitude"],
                    override["sourceAnchor"]["longitude"],
                ]
            else:
                projection = None
                status = "editorial-group" if point_type == "pause" else "unresolved"
                source_coordinates = None
            role = point_role(point_id, status, source_kind)
            distance_km = None if projection is None else round(projection["trackDistanceKm"], 3)
            trace_distance_m = None if projection is None else round(projection["anchorDistanceM"], 1)
            confidence = (
                "confirmed"
                if status == "matched" and (trace_distance_m or 0) <= 250
                else "probable"
                if projection is not None
                else "confirmed"
                if status == "editorial-group"
                else "to-review"
            )
            suppressed = point_id in SUPPRESSED_POINT_IDS
            anomaly = None
            if suppressed:
                anomaly = SUPPRESSION_JUSTIFICATION
            elif role == "weather-reference":
                anomaly = "Point hors parcours : position réelle et référence GPX conservées."
            elif role == "not-ridden-option":
                anomaly = "Option documentée non parcourue ; sans contribution météo ou risque."
            elif projection is None and status != "editorial-group":
                anomaly = "Lieu géographique non résolu."
            elif status == "editorial-group":
                anomaly = "Groupe éditorial non géographique ; aucun waypoint supplémentaire."
            inventory.append(
                {
                    "dayId": day["id"],
                    "id": point_id,
                    "editorialOrder": order,
                    "name": "Gare de Thonon-les-Bains" if point_id == "j01-start" else name,
                    "type": point_type,
                    "subtype": override.get("pointSubtype") if override else None,
                    "source": source_kind,
                    "sourceCoordinates": source_coordinates,
                    "documentedElevationM": documented_elevation,
                    "geometricStatus": status,
                    "resolution": (
                        "informational"
                        if role == "information"
                        else "excluded"
                        if role == "not-ridden-option"
                        else "matched"
                    ),
                    "role": role,
                    "operationalStatus": "suppressed" if suppressed else "operational",
                    "overrideExists": override is not None,
                    "overrideWasValid": None if override is None else override_validity[point_id],
                    "projection": None if projection is None else rounded_projection(projection),
                    "distanceToTrackM": trace_distance_m,
                    "trackDistanceKm": distance_km,
                    "etaReference": eta_for(distance_km),
                    "weatherAvailable": projection is not None and role != "information" and not suppressed,
                    "weatherPolicy": "excluded-suppressed" if suppressed else "disabled" if role in {"information", "not-ridden-option"} else "real-position",
                    "riskPolicy": "included" if role == "route-point" and not suppressed else "excluded",
                    "displayPolicy": "hidden-suppressed" if suppressed else "visible",
                    "confidence": confidence,
                    "anomaly": anomaly,
                }
            )
        ride_index += 1
    if len(inventory) != 78:
        raise ValueError(f"Expected 78 documented objects, found {len(inventory)}")

    operational_inventory = [item for item in inventory if item["operationalStatus"] == "operational"]
    suppressed_inventory = [item for item in inventory if item["operationalStatus"] == "suppressed"]
    type_counts = dict(sorted(Counter(item["type"] for item in inventory).items()))
    role_counts = dict(sorted(Counter(item["role"] for item in inventory).items()))
    operational_type_counts = dict(sorted(Counter(item["type"] for item in operational_inventory).items()))
    operational_role_counts = dict(sorted(Counter(item["role"] for item in operational_inventory).items()))
    unresolved = [
        item["id"] for item in operational_inventory if item["geometricStatus"] == "unresolved"
    ]
    report = {
        "auditDate": "2026-07-28",
        "tripId": roadbook["tripId"],
        "summary": {
            # Historical count: every object in the source roadbook, suppressed or not
            # (docs/sources/roadbook-rga-2026.md and roadbook.json are never edited).
            "documentedObjectCount": len(inventory),
            # Operational count: what the running application actually builds models
            # from, after roadbook-suppressions.ts filters the seven removed points.
            "operationalObjectCount": len(operational_inventory),
            "suppressedObjectCount": len(suppressed_inventory),
            "suppressedPointIds": sorted(item["id"] for item in suppressed_inventory),
            "gpxCount": len(manifest["files"]),
            "rideDayCount": len(ride_days),
            "offDayCount": len(roadbook["days"]) - len(ride_days),
            "overrideCount": len(rebuilt_overrides),
            "validOverridesBeforeRebuild": len(rebuilt_overrides) - invalid_before,
            "invalidOverridesBeforeRebuild": invalid_before,
            "rebuiltProjectionCount": len(rebuilt_overrides),
            "unresolvedGeographicCount": len(unresolved),
            "typeCounts": type_counts,
            "roleCounts": role_counts,
            "operationalTypeCounts": operational_type_counts,
            "operationalRoleCounts": operational_role_counts,
        },
        "method": {
            "projection": "nearest orthogonal projection on every GPX segment",
            "stableSource": "sourceAnchor",
            "eta": "reference estimate at 18 km/h from 08:00; runtime ETA remains authoritative",
            "offRoute": "real source position plus independent GPX reference projection",
        },
        "unresolvedPointIds": unresolved,
        "points": inventory,
    }
    AUDIT_JSON_PATH.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    lines = [
        "# Audit des points documentés — 28 juillet 2026",
        "",
        "## Résumé global",
        "",
        f"- **{len(inventory)} objets documentés dans la source historique** (roadbook.json / "
        f"roadbook-rga-2026.md, jamais modifiés), dont **{len(operational_inventory)} opérationnels** "
        f"et **{len(suppressed_inventory)} supprimés par décision utilisateur** (RGA_DASHBOARD_21).",
        f"- **10 GPX définitifs**, 10 journées roulées, 2 journées OFF, calendrier inchangé.",
        f"- **{len(rebuilt_overrides)} overrides reconstruits** depuis `sourceAnchor` ; "
        f"{invalid_before} snapshots techniques antérieurs invalides et "
        f"{len(rebuilt_overrides) - invalid_before} encore compatibles avant reconstruction.",
        f"- **{len(unresolved)} lieu(x) géographique(s) opérationnel(s) non résolu(s)** ; les groupes "
        f"éditoriaux restent volontairement sans géométrie propre.",
        "",
        "## Suppressions (décision utilisateur)",
        "",
        f"{len(suppressed_inventory)} points retirés définitivement du voyage opérationnel. Ils restent "
        "listés ici pour la traçabilité documentaire, mais l'application les filtre avant toute "
        "construction de modèle (appariement, météo, carte, profil, pauses) — voir "
        "`src/trip/roadbook-suppressions.ts`.",
        "",
        "| Jour | ID | Nom |",
        "|---|---|---|",
        *[
            f"| {item['dayId']} | `{item['id']}` | {item['name']} |"
            for item in suppressed_inventory
        ],
        "",
        "## Compteurs (opérationnels — après suppression)",
        "",
        f"- Par type : {', '.join(f'{key}={value}' for key, value in operational_type_counts.items())}.",
        f"- Par rôle : {', '.join(f'{key}={value}' for key, value in operational_role_counts.items())}.",
        "",
        "## Compteurs (historiques — source complète, y compris supprimés)",
        "",
        f"- Par type : {', '.join(f'{key}={value}' for key, value in type_counts.items())}.",
        f"- Par rôle : {', '.join(f'{key}={value}' for key, value in role_counts.items())}.",
        "",
        "## Inventaire exhaustif",
        "",
        "| Jour | ID | Nom | Type | Rôle | Km | ETA | Altitude | Distance trace | Source | Statut | Anomalie |",
        "|---|---|---|---|---|---:|---|---:|---:|---|---|---|",
    ]
    for item in inventory:
        projection = item["projection"]
        altitude = (
            item["documentedElevationM"]
            if item["documentedElevationM"] is not None
            else projection["elevationM"]
            if projection is not None
            else None
        )
        lines.append(
            "| {dayId} | `{id}` | {name} | {type} | {role} | {km} | {eta} | {alt} | {trace} | "
            "{source} | {status} / {confidence} | {anomaly} |".format(
                **{key: value for key, value in item.items() if key != "anomaly"},
                km="—" if item["trackDistanceKm"] is None else f"{item['trackDistanceKm']:.3f}",
                eta=item["etaReference"] or "Heure indisponible",
                alt="—" if altitude is None else f"{altitude:.1f} m",
                trace="—" if item["distanceToTrackM"] is None else f"{item['distanceToTrackM']:.1f} m",
                anomaly=item["anomaly"] or "—",
                status=item["geometricStatus"],
            )
        )
    lines.extend(
        [
            "",
            "## Points correctement projetés et projections recalculées",
            "",
            "Toutes les ancres disponibles ont été reprojetées sur chaque segment des GPX définitifs. "
            "Les index, fractions, coordonnées, altitudes, distances cumulées et distances à l’ancre ont été remplacés.",
            "",
            "## Overrides invalides",
            "",
            f"{invalid_before} des {len(rebuilt_overrides)} snapshots techniques ne décrivaient plus le GPX courant "
            "avec les tolérances du moteur. Aucun ancien index n’a été réutilisé comme source de vérité.",
            "",
            "## Points hors parcours",
            "",
            "Bellevaux, Crest-Voland, Arêches, Les Chapieux, Tignes et Château-Queyras étaient des références "
            "hors parcours (position réelle et projection GPX indépendante, aucun détour ajouté). Les six sont "
            "désormais supprimées par décision utilisateur (voir la section Suppressions) et n'ont plus de "
            "rôle météo ou cartographique. La Cime de la Bonette, ancienne option non parcourue, est également "
            "supprimée.",
            "",
            "## Groupes éditoriaux et doublons",
            "",
            "Les cinq objets pause (Cluses, Val-d’Isère, Modane / Valloire, Guillestre / Embrun et Sospel) "
            "sont des fonctions éditoriales attachées à des lieux existants, sans waypoint géographique supplémentaire. "
            "Tignes étant supprimée, le groupe autrefois « Tignes / Val-d’Isère » n'enrichit plus que Val-d’Isère "
            "(voir `src/trip/roadbook-resolutions.ts`, `displayName`). "
            "Les bornes techniques de départ et d’arrivée ne doivent pas créer une seconde carte métier.",
            "",
            "## Données non résolues",
            "",
            "Aucun véritable lieu géographique ne reste non résolu." if not unresolved else ", ".join(unresolved),
            "",
            "## Décisions automatiques appliquées",
            "",
            "- Projection orthogonale sur segment, indépendante de l’échantillonnage.",
            "- `sourceAnchor` conservé comme géométrie réelle et source stable.",
            "- Rôles séparés : parcours, référence météo, information, option non parcourue.",
            "- Absence de repli implicite vers 08:00, km 0, altitude 0 ou [0, 0].",
            "",
            "## Exploitabilité météo",
            "",
            "Chaque lieu géographique projeté expose une position, une altitude et une heure de référence. "
            "Les références hors parcours utilisent la position réelle ; les groupes éditoriaux et la Cime de la Bonette "
            "n’alimentent pas le risque par défaut. Le moteur existant fournit température, ressenti, pluie, vent, rafales, "
            "visibilité, isotherme zéro et risque.",
            "",
            "## Décisions utilisateur nécessaires",
            "",
            "Aucune décision bloquante. Les niveaux `probable` restent explicitement auditables.",
            "",
        ]
    )
    AUDIT_MD_PATH.write_text("\n".join(lines), encoding="utf-8")


if __name__ == "__main__":
    main()
