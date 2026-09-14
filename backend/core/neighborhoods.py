"""Official City of Fremont neighborhood for a point, computed locally.

The Neighborhoods layer (registry source fremont-neighborhoods-gis) is fetched once per process as
WGS84 GeoJSON through the polite Fetcher and cached. Each lookup is then a local point-in-polygon
test, so tagging a thousand records costs one request instead of one per record. Tests replace the
loader with set_loader().
"""

import json
import math
import threading
from collections.abc import Callable
from urllib.parse import urlencode

from core.fetcher import Fetcher
from core.registry import get_source

SOURCE_ID = "fremont-neighborhoods-gis"
QUERY = {"where": "1=1", "outFields": "NAME", "returnGeometry": "true", "outSR": "4326", "f": "geojson"}

Point = tuple[float, float]  # (lng, lat), the GeoJSON axis order
Ring = list[Point]
Polygon = list[Ring]  # outer ring first, then holes
BBox = tuple[float, float, float, float]  # min lng, min lat, max lng, max lat


def layer_query_url() -> str:
    base = get_source(SOURCE_ID).url.split("?")[0]
    return f"{base}?{urlencode(QUERY)}"


def fetch_geojson(fetcher: Fetcher | None = None) -> dict:
    fetcher = fetcher or Fetcher()
    url = layer_query_url()
    artifact = fetcher.fetch(url, "http", None, True)
    if not artifact.status or artifact.status >= 400:
        raise RuntimeError(f"neighborhoods layer query failed with status {artifact.status}")
    data = json.loads(artifact.raw.decode("utf-8"))
    if "error" in data:
        raise RuntimeError(f"neighborhoods layer query failed: {data['error']}")
    return data


_loader: Callable[[Fetcher | None], dict] = fetch_geojson
_areas: list[tuple[str, list[tuple[BBox, Polygon]]]] | None = None
_lock = threading.Lock()


def set_loader(loader: Callable[[Fetcher | None], dict]) -> None:
    """Replace how the layer GeoJSON is loaded (tests) and drop the cached polygons."""
    global _loader, _areas
    with _lock:
        _loader, _areas = loader, None


def reset() -> None:
    set_loader(fetch_geojson)


def _polygons(geometry: dict) -> list[Polygon]:
    kind, coordinates = geometry.get("type"), geometry.get("coordinates") or []
    if kind == "Polygon":
        shapes = [coordinates]
    elif kind == "MultiPolygon":
        shapes = coordinates
    else:
        return []
    polygons = []
    for shape in shapes:
        rings = [[(float(point[0]), float(point[1])) for point in ring] for ring in shape if len(ring) >= 3]
        if rings:
            polygons.append(rings)
    return polygons


def _bbox(ring: Ring) -> BBox:
    xs, ys = [x for x, _ in ring], [y for _, y in ring]
    return min(xs), min(ys), max(xs), max(ys)


def _loaded(fetcher: Fetcher | None) -> list[tuple[str, list[tuple[BBox, Polygon]]]]:
    global _areas
    with _lock:
        if _areas is None:
            areas = []
            for feature in _loader(fetcher).get("features", []):
                name = " ".join(str((feature.get("properties") or {}).get("NAME") or "").split())
                polygons = [(_bbox(polygon[0]), polygon) for polygon in _polygons(feature.get("geometry") or {})]
                if name and polygons:
                    areas.append((name, polygons))
            if not areas:
                raise RuntimeError("the neighborhoods layer returned no polygons")
            _areas = areas
        return _areas


def ring_contains(ring: Ring, x: float, y: float) -> bool:
    """Even-odd ray casting; works for closed or open rings."""
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i]
        xj, yj = ring[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def polygon_contains(polygon: Polygon, x: float, y: float) -> bool:
    return bool(polygon) and ring_contains(polygon[0], x, y) and not any(
        ring_contains(hole, x, y) for hole in polygon[1:]
    )


def neighborhood_for(lat: float | None, lng: float | None, fetcher: Fetcher | None = None) -> str | None:
    """The official neighborhood containing the point, or None outside every neighborhood."""
    try:
        y, x = float(lat), float(lng)
    except (TypeError, ValueError):
        return None
    if not (math.isfinite(x) and math.isfinite(y)):
        return None
    for name, polygons in _loaded(fetcher):
        for (min_x, min_y, max_x, max_y), polygon in polygons:
            if min_x <= x <= max_x and min_y <= y <= max_y and polygon_contains(polygon, x, y):
                return name
    return None


def names(fetcher: Fetcher | None = None) -> list[str]:
    return sorted(name for name, _ in _loaded(fetcher))
