"""
Datascape API client.

Flow:
  1. POST credentials to /connect/token            -> access_token
  2. GET  /v1/elements                             -> elements.json
  3. Parse unique (StationId, StationName) pairs from the elements response
  4. For each station:
       GET /v1/stations/{id}/cam-photos/last       -> cam_photos.json
  5. For each station:
       GET /v3/elements?station_id={id}...         -> station_elements.json
  6. For each station:
       GET /v1/stations/{id}/photos                -> station_photos.json
       (response is a list of filenames; the script then builds the full
        image URL using the discovered pattern:
          /v1/stations/{id}/photos/{filename}?width=W&height=H)
  7. Optional: download all images to ./images/{stationId}/{filename}
"""

import json
import os
import sys
import time
import urllib.parse
import requests

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
BASE_URL = "http://115.186.56.181/datascapea"
TOKEN_URL = f"{BASE_URL}/connect/token"
ELEMENTS_URL = f"{BASE_URL}/v1/elements"
CAM_PHOTOS_URL_TEMPLATE = f"{BASE_URL}/v1/stations/{{station_id}}/cam-photos/last"
V3_ELEMENTS_URL = f"{BASE_URL}/v3/elements"
STATION_PHOTOS_URL_TEMPLATE = f"{BASE_URL}/v1/stations/{{station_id}}/photos"
PHOTO_FILE_URL_TEMPLATE = f"{BASE_URL}/v1/stations/{{station_id}}/photos/{{filename}}"

USERNAME = "DatascapeUser"
PASSWORD = "hQKPv8N27RxWQu3t4DE0"
CLIENT_ID = "GenericClient"
CLIENT_INSTANCE = "12345"

ELEMENTS_OUTPUT = "elements.json"
CAM_PHOTOS_OUTPUT = "cam_photos.json"
STATION_ELEMENTS_OUTPUT = "station_elements.json"
STATION_PHOTOS_OUTPUT = "station_photos.json"

# Image dimensions to request in the photo URL — match the values from the
# browser's network tab. Set to None to omit the params.
PHOTO_WIDTH = 1400
PHOTO_HEIGHT = 1120

# Set to True to download every photo to ./images/{stationId}/{filename}.
# Set to False if you only want the JSON with URLs.
DOWNLOAD_IMAGES = True
IMAGES_DIR = "images"

NUM_PHOTOS = 1
REQUEST_TIMEOUT = 60
SLEEP_BETWEEN_CALLS = 0.1


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------
def get_access_token() -> str:
    payload = {
        "username": USERNAME,
        "password": PASSWORD,
        "grant_type": "password",
        "client_id": CLIENT_ID,
        "client_instance": CLIENT_INSTANCE,
    }
    headers = {"Content-Type": "application/x-www-form-urlencoded"}
    response = requests.post(TOKEN_URL, data=payload, headers=headers, timeout=30)
    response.raise_for_status()
    data = response.json()
    token = data.get("access_token")
    if not token:
        raise RuntimeError(f"No access_token in response: {data}")
    return token


def auth_headers(token: str) -> dict:
    return {"Accept": "*/*", "Authorization": f"Bearer {token}"}


# ---------------------------------------------------------------------------
# /v1/elements (source of truth for station list)
# ---------------------------------------------------------------------------
def fetch_elements(token: str):
    fields = [
        "ElementName",
        "ElementId",
        "CustomElementId",
        "StationName",
        "StationId",
        "CustomStationId",
        "Basin",
        "River",
        "StartDate",
        "EndDate",
        "Decimals",
        "MeasUnit",
        "Time",
        "Value",
        "Trend",
        "StateId",
        "QuantityOrgId",
        "QuantityId",
        "StateDescr",
        "Dtr",
        "IsVirtual",
        "IsQueryable",
    ]
    params = (
        [("category", "All")]
        + [("field", f) for f in fields]
        + [("ui_culture", "en-US")]
    )
    response = requests.get(
        ELEMENTS_URL,
        params=params,
        headers=auth_headers(token),
        timeout=REQUEST_TIMEOUT,
    )
    response.raise_for_status()
    return response.json()


def _iter_element_records(elements):
    if isinstance(elements, list):
        yield from elements
        return
    if isinstance(elements, dict):
        for key in ("items", "data", "results", "elements"):
            value = elements.get(key)
            if isinstance(value, list):
                yield from value
                return


def extract_stations_from_elements(elements) -> list:
    id_keys = ("StationId", "stationId", "station_id")
    name_keys = ("StationName", "stationName", "station_name")

    seen = {}
    for record in _iter_element_records(elements):
        if not isinstance(record, dict):
            continue

        station_id = None
        for k in id_keys:
            if k in record and record[k] not in (None, ""):
                station_id = record[k]
                break
        if station_id is None:
            continue

        station_name = ""
        for k in name_keys:
            if k in record and record[k]:
                station_name = record[k]
                break

        if station_id not in seen or (not seen[station_id] and station_name):
            seen[station_id] = station_name

    stations = [{"stationId": sid, "stationName": name} for sid, name in seen.items()]
    stations.sort(key=lambda s: str(s["stationId"]))
    return stations


# ---------------------------------------------------------------------------
# Photo URL builder
# ---------------------------------------------------------------------------
def build_photo_url(station_id, filename: str) -> str:
    """
    Build the full URL to fetch an actual image, matching the pattern observed
    in the browser's network tab:
        /v1/stations/{id}/photos/{filename}?width=W&height=H
    The path component is URL-encoded so filenames with spaces or special
    characters (e.g. "ARG-2 DAMAGE OF THE SENSOR.jpg") work correctly.
    """
    encoded = urllib.parse.quote(filename)
    url = PHOTO_FILE_URL_TEMPLATE.format(station_id=station_id, filename=encoded)
    if PHOTO_WIDTH and PHOTO_HEIGHT:
        url += f"?width={PHOTO_WIDTH}&height={PHOTO_HEIGHT}"
    return url


# ---------------------------------------------------------------------------
# Per-station fetchers
# ---------------------------------------------------------------------------
def _safe_json(response):
    if not response.content:
        return None
    try:
        return response.json()
    except ValueError:
        return {"raw": response.text}


def fetch_cam_photos_for_station(token, station_id, station_name):
    url = CAM_PHOTOS_URL_TEMPLATE.format(station_id=station_id)
    params = {
        "numPhotos": NUM_PHOTOS,
        "stationName": station_name,
        "_": int(time.time() * 1000),
    }
    response = requests.get(
        url, params=params, headers=auth_headers(token), timeout=REQUEST_TIMEOUT
    )
    if response.status_code in (204, 404):
        return None
    response.raise_for_status()
    return _safe_json(response)


def fetch_v3_elements_for_station(token, station_id):
    fields = [
        "ElementName",
        "Time",
        "Value",
        "Decimals",
        "MeasUnit",
        "Trend",
        "StateId",
        "IsQueryable",
    ]
    params = [
        ("station_id", station_id),
        ("longitude", ""),
        ("latitude", ""),
        ("category", 1),
        ("ui_culture", "en"),
    ]
    params += [("field", f) for f in fields]
    params += [
        ("filter_central_id", ""),
        ("filter_id", ""),
        ("_", int(time.time() * 1000)),
    ]
    response = requests.get(
        V3_ELEMENTS_URL,
        params=params,
        headers=auth_headers(token),
        timeout=REQUEST_TIMEOUT,
    )
    if response.status_code in (204, 404):
        return None
    response.raise_for_status()
    return _safe_json(response)


def fetch_station_photos(token, station_id):
    """
    GET /v1/stations/{id}/photos -> list of filenames like ["ARG-1.jpg", ...].
    We then convert each filename into a `{filename, url}` object so consumers
    have a directly usable URL.
    """
    url = STATION_PHOTOS_URL_TEMPLATE.format(station_id=station_id)
    params = {"_": int(time.time() * 1000)}
    response = requests.get(
        url, params=params, headers=auth_headers(token), timeout=REQUEST_TIMEOUT
    )
    if response.status_code in (204, 404):
        return None
    response.raise_for_status()
    payload = _safe_json(response)

    # The endpoint returns a bare list of filenames; transform into objects
    # with both filename and URL. Be defensive about other shapes.
    if isinstance(payload, list):
        return [
            {"filename": fn, "url": build_photo_url(station_id, fn)}
            for fn in payload
            if isinstance(fn, str)
        ]
    return payload  # unknown shape — return as-is for inspection


# ---------------------------------------------------------------------------
# Image download
# ---------------------------------------------------------------------------
def _safe_filename(name: str) -> str:
    """Make a filename safe for the local filesystem (Windows-friendly)."""
    bad = '<>:"/\\|?*'
    cleaned = "".join("_" if c in bad else c for c in name).strip()
    return cleaned or "unnamed"


def download_image(token, station_id, photo: dict, dest_dir: str) -> dict:
    """Download one image and return a status dict."""
    filename = photo["filename"]
    url = photo["url"]
    out_path = os.path.join(dest_dir, _safe_filename(filename))

    if os.path.exists(out_path) and os.path.getsize(out_path) > 0:
        return {"filename": filename, "path": out_path, "status": "skipped (exists)"}

    response = requests.get(
        url, headers=auth_headers(token), timeout=REQUEST_TIMEOUT, stream=True
    )
    if response.status_code in (204, 404):
        return {"filename": filename, "status": f"HTTP {response.status_code}"}
    response.raise_for_status()

    with open(out_path, "wb") as f:
        for chunk in response.iter_content(chunk_size=8192):
            if chunk:
                f.write(chunk)
    return {
        "filename": filename,
        "path": out_path,
        "status": "ok",
        "bytes": os.path.getsize(out_path),
    }


def download_all_images(token, station_photos_payload):
    """Iterate the station_photos.json structure and download every image."""
    os.makedirs(IMAGES_DIR, exist_ok=True)
    summary = {"downloaded": 0, "skipped": 0, "errors": []}

    entries = station_photos_payload.get("data", [])
    for entry in entries:
        photos = entry.get("data")
        if not isinstance(photos, list) or not photos:
            continue

        station_id = entry["stationId"]
        station_name = entry.get("stationName", "")
        dest_dir = os.path.join(IMAGES_DIR, _safe_filename(str(station_id)))
        os.makedirs(dest_dir, exist_ok=True)

        for photo in photos:
            if not isinstance(photo, dict) or "filename" not in photo:
                continue
            try:
                result = download_image(token, station_id, photo, dest_dir)
                if result["status"] == "ok":
                    summary["downloaded"] += 1
                elif result["status"].startswith("skipped"):
                    summary["skipped"] += 1
                else:
                    summary["errors"].append(
                        {
                            "stationId": station_id,
                            "stationName": station_name,
                            "filename": photo["filename"],
                            "error": result["status"],
                        }
                    )
                print(f"  {station_id} {photo['filename']!r} -> {result['status']}")
            except requests.HTTPError as e:
                summary["errors"].append(
                    {
                        "stationId": station_id,
                        "stationName": station_name,
                        "filename": photo["filename"],
                        "error": f"HTTP {e.response.status_code}",
                    }
                )
                print(
                    f"  {station_id} {photo['filename']!r} -> HTTP {e.response.status_code}"
                )
            except requests.RequestException as e:
                summary["errors"].append(
                    {
                        "stationId": station_id,
                        "stationName": station_name,
                        "filename": photo["filename"],
                        "error": str(e),
                    }
                )
                print(f"  {station_id} {photo['filename']!r} -> error: {e}")
            time.sleep(SLEEP_BETWEEN_CALLS)

    return summary


# ---------------------------------------------------------------------------
# Per-station loop
# ---------------------------------------------------------------------------
def loop_over_stations(token, stations, fetch_fn, label: str) -> dict:
    results = []
    errors = []

    for i, station in enumerate(stations, start=1):
        station_id = station["stationId"]
        station_name = station["stationName"]

        try:
            payload = fetch_fn(token, station_id, station_name)
            results.append(
                {
                    "stationId": station_id,
                    "stationName": station_name,
                    "data": payload,
                }
            )
            status = "empty" if payload is None else "ok"
        except requests.HTTPError as e:
            status = f"HTTP {e.response.status_code}"
            errors.append(
                {
                    "stationId": station_id,
                    "stationName": station_name,
                    "error": status,
                    "body": e.response.text[:500],
                }
            )
        except requests.RequestException as e:
            status = f"error: {e}"
            errors.append(
                {
                    "stationId": station_id,
                    "stationName": station_name,
                    "error": str(e),
                }
            )

        print(
            f"  [{label} {i}/{len(stations)}] {station_id} {station_name!r} -> {status}"
        )
        time.sleep(SLEEP_BETWEEN_CALLS)

    return {
        "stationCount": len(stations),
        "errorCount": len(errors),
        "errors": errors,
        "data": results,
    }


def _cam_photos_adapter(token, station_id, station_name):
    return fetch_cam_photos_for_station(token, station_id, station_name)


def _v3_elements_adapter(token, station_id, _station_name):
    return fetch_v3_elements_for_station(token, station_id)


def _station_photos_adapter(token, station_id, _station_name):
    return fetch_station_photos(token, station_id)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def save_json(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def main() -> int:
    try:
        print("Requesting access token...")
        token = get_access_token()
        print(f"Got token ({len(token)} chars).\n")

        # 1. /v1/elements
        print("Fetching /v1/elements...")
        elements = fetch_elements(token)
        save_json(ELEMENTS_OUTPUT, elements)
        elem_count = (
            len(elements)
            if isinstance(elements, list)
            else len(elements.get("items", []) or [])
        )
        print(f"Saved {elem_count} element records to {ELEMENTS_OUTPUT}")

        # 2. Derive station list
        stations = extract_stations_from_elements(elements)
        print(f"Extracted {len(stations)} unique stations from elements.\n")

        if not stations:
            print("No stations found in elements response.", file=sys.stderr)
            return 1

        # 3. cam-photos per station
        print("Fetching cam photos per station...")
        cam_photos = loop_over_stations(token, stations, _cam_photos_adapter, "cam")
        save_json(CAM_PHOTOS_OUTPUT, cam_photos)
        print(
            f"Saved cam photos for {len(cam_photos['data'])} stations to "
            f"{CAM_PHOTOS_OUTPUT} (errors: {cam_photos['errorCount']})\n"
        )

        # 4. /v3/elements per station
        print("Fetching /v3/elements per station...")
        station_elements = loop_over_stations(
            token, stations, _v3_elements_adapter, "v3"
        )
        save_json(STATION_ELEMENTS_OUTPUT, station_elements)
        print(
            f"Saved /v3/elements for {len(station_elements['data'])} stations to "
            f"{STATION_ELEMENTS_OUTPUT} (errors: {station_elements['errorCount']})\n"
        )

        # 5. /v1/stations/{id}/photos per station (with constructed URLs)
        print("Fetching /photos per station (with constructed image URLs)...")
        station_photos = loop_over_stations(
            token, stations, _station_photos_adapter, "photos"
        )
        save_json(STATION_PHOTOS_OUTPUT, station_photos)
        print(
            f"Saved /photos for {len(station_photos['data'])} stations to "
            f"{STATION_PHOTOS_OUTPUT} (errors: {station_photos['errorCount']})\n"
        )

        # 6. Optionally download every image to disk
        if DOWNLOAD_IMAGES:
            print(f"Downloading images to ./{IMAGES_DIR}/...")
            summary = download_all_images(token, station_photos)
            print(
                f"\nDownloaded: {summary['downloaded']}, "
                f"Skipped (already existed): {summary['skipped']}, "
                f"Errors: {len(summary['errors'])}"
            )
        else:
            print("Image download disabled (set DOWNLOAD_IMAGES = True to enable).")

        return 0

    except requests.HTTPError as e:
        print(
            f"HTTP error: {e.response.status_code} {e.response.reason}", file=sys.stderr
        )
        print(f"URL: {e.response.url}", file=sys.stderr)
        print(f"Body: {e.response.text[:500]}", file=sys.stderr)
        return 1
    except requests.RequestException as e:
        print(f"Request failed: {e}", file=sys.stderr)
        return 1
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
