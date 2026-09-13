"""A small Google Places search API.

Examples:
    GET /places/search?q=Stanford%20University
    GET /places/search?q=Eiffel%20Tower

Set GOOGLE_MAPS_API_KEY before starting the server.  The key stays on the
server; callers never need to send it.
"""

import os

import requests
from dotenv import load_dotenv
from flask import Flask, jsonify, render_template, request


load_dotenv()
app = Flask(__name__)

PLACES_TEXT_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText"
PLACES_AUTOCOMPLETE_URL = "https://places.googleapis.com/v1/places:autocomplete"
FIELD_MASK = "places.id,places.displayName,places.formattedAddress,places.location,places.googleMapsUri"
AUTOCOMPLETE_FIELD_MASK = "suggestions.placePrediction.placeId,suggestions.placePrediction.text.text,suggestions.placePrediction.structuredFormat"


@app.get("/")
def index():
    """Serve the simple place-search website."""
    return render_template("index.html")


@app.get("/health")
def health():
    """Simple readiness check that does not contact Google."""
    return {"status": "ok"}


@app.get("/places/autocomplete")
def autocomplete_places():
    """Suggest likely place names while the user is typing."""
    query = request.args.get("q", "").strip()
    # Avoid charging for one-letter searches that are not useful suggestions.
    if len(query) < 2:
        return jsonify(suggestions=[])

    api_key = os.environ.get("GOOGLE_MAPS_API_KEY")
    if not api_key:
        return jsonify(error="GOOGLE_MAPS_API_KEY is not configured on the server."), 500

    try:
        response = requests.post(
            PLACES_AUTOCOMPLETE_URL,
            headers={
                "Content-Type": "application/json",
                "X-Goog-Api-Key": api_key,
                "X-Goog-FieldMask": AUTOCOMPLETE_FIELD_MASK,
            },
            json={"input": query},
            timeout=10,
        )
        response.raise_for_status()
    except requests.RequestException:
        return jsonify(error="Google Places autocomplete failed."), 502

    suggestions = []
    for suggestion in response.json().get("suggestions", []):
        prediction = suggestion.get("placePrediction")
        if not prediction:
            continue
        text = prediction.get("text", {}).get("text")
        structured = prediction.get("structuredFormat", {})
        suggestions.append(
            {
                "place_id": prediction.get("placeId"),
                "text": text,
                "primary_text": structured.get("mainText", {}).get("text"),
                "secondary_text": structured.get("secondaryText", {}).get("text"),
            }
        )
    return jsonify(suggestions=suggestions)


@app.get("/places/search")
def search_places():
    """Find locations from a short name or a full address.

    `q` can be as short as a venue name, for example `Stanford University`.
    Optional `limit` controls returned matches (1 through 20; default 5).
    """
    query = request.args.get("q", "").strip()
    if not query:
        return jsonify(error="Provide a place name in the 'q' query parameter."), 400

    try:
        limit = int(request.args.get("limit", 5))
    except ValueError:
        return jsonify(error="'limit' must be a number between 1 and 20."), 400
    if not 1 <= limit <= 20:
        return jsonify(error="'limit' must be between 1 and 20."), 400

    api_key = os.environ.get("GOOGLE_MAPS_API_KEY")
    if not api_key:
        return jsonify(error="GOOGLE_MAPS_API_KEY is not configured on the server."), 500

    try:
        response = requests.post(
            PLACES_TEXT_SEARCH_URL,
            headers={
                "Content-Type": "application/json",
                "X-Goog-Api-Key": api_key,
                "X-Goog-FieldMask": FIELD_MASK,
            },
            json={"textQuery": query, "maxResultCount": limit},
            timeout=10,
        )
        response.raise_for_status()
    except requests.RequestException:
        # Do not return Google's raw response: it can expose implementation details.
        return jsonify(error="Google Places search failed."), 502

    places = []
    for place in response.json().get("places", []):
        location = place.get("location", {})
        places.append(
            {
                "place_id": place.get("id"),
                "name": place.get("displayName", {}).get("text"),
                "address": place.get("formattedAddress"),
                "latitude": location.get("latitude"),
                "longitude": location.get("longitude"),
                "google_maps_url": place.get("googleMapsUri"),
            }
        )

    return jsonify(query=query, count=len(places), places=places)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)), debug=True)
