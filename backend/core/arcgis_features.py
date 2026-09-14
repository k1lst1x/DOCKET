"""City of Fremont ArcGIS layer features as documents, one per feature (or per group), neighborhood-tagged.

The expander pages through {layer}/query with resultOffset/resultRecordCount until the server stops
reporting exceededTransferLimit, asking for WGS84 geometry. Each feature gets a representative point
(the point itself, the area centroid of a polygon's largest ring, or the middle vertex of a line's
longest path; returnCentroid is not reliable on these layers) and the official neighborhood there.

params:
  layer           FeatureServer layer URL
  title           format string over attributes; title_fallback is used when a title field is blank
  fields          {attribute: label} allowlist; only these attributes are requested or stored
  group_by        optional attributes; features sharing their values and the same neighborhood become
                  one document that lists each feature (e.g. street segments of one resurfacing program)
  object_id_field default OBJECTID
  max_pages       default 50
"""

import json
import math
import string
from urllib.parse import quote, urlencode

from core import neighborhoods
from core.discovery import DocumentRef
from core.fetcher import Fetcher
from core.geo import slugify
from core.registry import Source

PAGE_SIZE = 1000
DEFAULT_MAX_PAGES = 50


def template_fields(template: str) -> list[str]:
    return [name for _, name, _, _ in string.Formatter().parse(template or "") if name]


def value_text(value: object) -> str:
    if value is None or isinstance(value, bool):
        return ""
    if isinstance(value, float):
        if not math.isfinite(value):
            return ""
        return str(int(value)) if value.is_integer() else f"{value:,.2f}"
    return " ".join(str(value).split())


def title_for(params: dict, attributes: dict[str, str]) -> str:
    template = params.get("title", "")
    names = template_fields(template)
    if names and all(attributes.get(name) for name in names):
        return " ".join(template.format_map(attributes).split())
    fallback = params.get("title_fallback", "")
    if fallback and all(attributes.get(name) for name in template_fields(fallback)):
        return " ".join(fallback.format_map(attributes).split())
    return "Untitled record"


def _vertices(sequence: list) -> list[tuple[float, float]]:
    return [(float(point[0]), float(point[1])) for point in sequence if len(point) >= 2]


def _ring_area_centroid(ring: list[tuple[float, float]]) -> tuple[float, tuple[float, float]]:
    x0, y0 = ring[0]  # shift to the first vertex to keep the cross products well conditioned
    points = [(x - x0, y - y0) for x, y in ring]
    area = cx = cy = 0.0
    for (xa, ya), (xb, yb) in zip(points, points[1:] + points[:1]):
        cross = xa * yb - xb * ya
        area += cross
        cx += (xa + xb) * cross
        cy += (ya + yb) * cross
    area /= 2
    if abs(area) < 1e-18:
        return 0.0, (sum(x for x, _ in ring) / len(ring), sum(y for _, y in ring) / len(ring))
    return abs(area), (cx / (6 * area) + x0, cy / (6 * area) + y0)


def _path_length(path: list[tuple[float, float]]) -> float:
    return sum(math.dist(a, b) for a, b in zip(path, path[1:]))


def representative_point(geometry: dict | None) -> tuple[float, float] | None:
    """(lat, lng) for an Esri JSON geometry in WGS84."""
    if not geometry:
        return None
    point = None
    if geometry.get("x") is not None and geometry.get("y") is not None:
        point = (float(geometry["x"]), float(geometry["y"]))
    elif geometry.get("points"):
        vertices = _vertices(geometry["points"])
        point = vertices[0] if vertices else None
    elif geometry.get("rings"):
        rings = [ring for ring in (_vertices(r) for r in geometry["rings"]) if len(ring) >= 3]
        if rings:
            point = max((_ring_area_centroid(ring) for ring in rings), key=lambda found: found[0])[1]
    elif geometry.get("paths"):
        paths = [path for path in (_vertices(p) for p in geometry["paths"]) if path]
        if paths:
            longest = max(paths, key=_path_length)
            point = longest[len(longest) // 2]
    if point is None or not all(math.isfinite(axis) for axis in point):
        return None
    return point[1], point[0]


def query_url(layer: str, out_fields: list[str], object_id: str, offset: int) -> str:
    query = {
        "where": "1=1",
        "outFields": ",".join(out_fields),
        "returnGeometry": "true",
        "outSR": "4326",
        "orderByFields": object_id,
        "resultOffset": offset,
        "resultRecordCount": PAGE_SIZE,
        "f": "json",
    }
    return f"{layer}/query?{urlencode(query)}"


def configured_fields(params: dict) -> tuple[dict[str, str], list[str], list[str]]:
    """(fields allowlist, group_by, attributes to request); raises when the title needs other attributes."""
    fields: dict[str, str] = params.get("fields") or {}
    if not fields:
        raise ValueError("arcgis_features needs params.fields")
    group_by = list(params.get("group_by") or [])
    title_names = template_fields(params.get("title", "")) + template_fields(params.get("title_fallback", ""))
    outside = [name for name in [*group_by, *title_names] if name not in fields]
    if outside:
        raise ValueError(f"title and group_by may only use allowlisted fields; not in fields: {outside}")
    return fields, group_by, list(fields)


def fetch_features(fetcher: Fetcher, source: Source) -> list[dict]:
    params = source.params
    layer = params["layer"].rstrip("/")
    object_id = params.get("object_id_field", "OBJECTID")
    _, _, requested = configured_fields(params)
    out_fields = list(dict.fromkeys([object_id, *requested]))
    features: list[dict] = []
    for _ in range(int(params.get("max_pages", DEFAULT_MAX_PAGES))):
        artifact = fetcher.fetch(query_url(layer, out_fields, object_id, len(features)), "http", None, source.send_user_agent)
        if not artifact.status or artifact.status >= 400:
            raise RuntimeError(f"ArcGIS query for {source.id} returned status {artifact.status}")
        data = json.loads(artifact.raw.decode("utf-8"))
        if "error" in data:
            raise RuntimeError(f"ArcGIS query for {source.id} failed: {data['error']}")
        page = data.get("features") or []
        features.extend(page)
        if not data.get("exceededTransferLimit") or not page:
            return features
    print(f"  warning: {source.id} stopped after max_pages with {len(features)} features")
    return features


def _where(names: list[str], raw: dict) -> str:
    clauses = []
    for name in names:
        value = raw.get(name)
        if value is None:
            clauses.append(f"{name} IS NULL")
        elif isinstance(value, (int, float)) and not isinstance(value, bool):
            clauses.append(f"{name}={value}")
        else:
            clauses.append(f"{name}='{str(value).replace(chr(39), chr(39) * 2)}'")
    return " AND ".join(clauses)


def _record_url(layer: str, where: str) -> str:
    return f"{layer}/query?where={quote(where, safe='')}&outFields=*&f=html"


def build_refs(source: Source, features: list[dict], fetcher: Fetcher | None = None) -> list[DocumentRef]:
    params = source.params
    layer = params["layer"].rstrip("/")
    object_id = params.get("object_id_field", "OBJECTID")
    fields, group_by, _ = configured_fields(params)
    records = []
    for feature in features:
        raw = feature.get("attributes") or {}
        attributes = {name: value_text(raw.get(name)) for name in fields}  # allowlisted attributes only
        point = representative_point(feature.get("geometry"))
        neighborhood = neighborhoods.neighborhood_for(point[0], point[1], fetcher) if point else None
        records.append((raw, attributes, point, neighborhood))

    def field_lines(attributes: dict[str, str], names: list[str]) -> list[str]:
        return [f"- {fields[name]}: {attributes[name]}" for name in names if attributes.get(name)]

    def location_lines(neighborhood: str | None, point: tuple[float, float] | None) -> list[str]:
        lines = [f"- Neighborhood: {neighborhood or 'unknown'}"]
        if point:
            lines.append(f"- Map location (approximate): {point[0]:.5f}, {point[1]:.5f}")
        return lines

    footer = f"Source: City of Fremont GIS layer, {source.name}."
    refs = []
    if not group_by:
        for raw, attributes, point, neighborhood in records:
            if raw.get(object_id) is None:
                continue
            title = title_for(params, attributes) + (f" – {neighborhood}" if neighborhood else "")
            lines = [f"# {title}", "", *field_lines(attributes, list(fields)), *location_lines(neighborhood, point)]
            refs.append(
                DocumentRef(
                    _record_url(layer, _where([object_id], raw)),
                    title,
                    "gis_feature",
                    inline_text="\n".join([*lines, "", footer]) + "\n",
                    locator="record",
                )
            )
    else:
        groups: dict[tuple, list] = {}
        for record in records:
            raw, attributes, _, neighborhood = record
            groups.setdefault((tuple(attributes[name] for name in group_by), neighborhood), []).append(record)
        for (_, neighborhood), members in groups.items():
            first_raw, first_attributes = members[0][0], members[0][1]
            # Values common to every location are printed once; a lone location keeps its own fields.
            shared = [
                name
                for name in fields
                if name in group_by or (len(members) > 1 and len({member[1][name] for member in members}) == 1)
            ]
            varying = [name for name in fields if name not in shared]
            title = title_for(params, first_attributes) + (f" – {neighborhood}" if neighborhood else "")
            lines = [
                f"# {title}",
                "",
                *field_lines(first_attributes, shared),
                f"- Neighborhood: {neighborhood or 'unknown'}",
                f"- Mapped locations: {len(members)}",
            ]
            # Points along one street segment often repeat every listed value; list such a location once.
            items: dict[tuple[str, ...], list[tuple[float, float]]] = {}
            for _, attributes, point, _ in members:
                items.setdefault(tuple(field_lines(attributes, varying)), []).extend([point] if point else [])
            for number, item_lines in enumerate(sorted(items), start=1):
                heading = item_lines[0].split(": ", 1)[1] if item_lines else f"Location {number}"
                lines += ["", f"## {heading}", *item_lines]
                points = sorted(items[item_lines])
                if points:
                    label = "Map location" if len(points) == 1 else "Map locations"
                    places = "; ".join(f"{lat:.5f}, {lng:.5f}" for lat, lng in points)
                    lines.append(f"- {label} (approximate): {places}")
            fragment = f"#{slugify(neighborhood)}" if neighborhood else "#neighborhood-unknown"
            refs.append(
                DocumentRef(
                    _record_url(layer, _where(group_by, first_raw)) + fragment,
                    title,
                    "gis_feature",
                    inline_text="\n".join([*lines, "", footer]) + "\n",
                    locator="record",
                )
            )
    refs.sort(key=lambda ref: (ref.title.lower(), ref.url))
    unique: dict[str, DocumentRef] = {}
    for ref in refs:
        unique.setdefault(ref.url, ref)
    return list(unique.values())


def expand(fetcher: Fetcher, source: Source, ref: DocumentRef) -> list[DocumentRef]:
    return build_refs(source, fetch_features(fetcher, source), fetcher)
