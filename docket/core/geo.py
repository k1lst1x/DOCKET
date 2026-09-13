"""Address lookup for Fremont.

The US Census geocoder turns a street address into coordinates, and the City of Fremont
Neighborhoods GIS layer (a registry source) gives the official neighborhood containing that point.
"""

import re

import httpx

from core import settings
from core.registry import get_source

CENSUS_GEOCODER = "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress"


def _headers() -> dict:
    return {"User-Agent": settings.USER_AGENT}


def geocode(address: str) -> dict | None:
    query = address if "fremont" in address.lower() else f"{address}, Fremont, CA"
    response = httpx.get(
        CENSUS_GEOCODER,
        params={"address": query, "benchmark": "Public_AR_Current", "format": "json"},
        headers=_headers(),
        timeout=30,
    )
    response.raise_for_status()
    matches = response.json().get("result", {}).get("addressMatches", [])
    if not matches:
        return None
    match = matches[0]
    return {
        "matched_address": match["matchedAddress"],
        "lat": match["coordinates"]["y"],
        "lng": match["coordinates"]["x"],
    }


def neighborhood_at(lat: float, lng: float) -> str | None:
    layer_query = get_source("fremont-neighborhoods-gis").url.split("?")[0]
    response = httpx.get(
        layer_query,
        params={
            "geometry": f"{lng},{lat}",
            "geometryType": "esriGeometryPoint",
            "inSR": "4326",
            "spatialRel": "esriSpatialRelIntersects",
            "outFields": "NAME",
            "returnGeometry": "false",
            "f": "json",
        },
        headers=_headers(),
        timeout=30,
    )
    response.raise_for_status()
    features = response.json().get("features", [])
    return features[0]["attributes"]["NAME"] if features else None


def slugify(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
