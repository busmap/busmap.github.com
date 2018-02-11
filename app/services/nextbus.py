import requests
import shapely.geometry


NEXTBUS_HOST = 'http://webservices.nextbus.com'
NEXTBUS_API_PATH = NEXTBUS_HOST + '/service/publicJSONFeed'

AGENCY = 'sf-muni'

ROUTES_URL = (
    NEXTBUS_API_PATH + '?command=routeConfig&a=' + AGENCY
)

PREDICTIONS_URL = (
    NEXTBUS_API_PATH + '?command=predictionsForMultiStops&a=' + AGENCY + '&{stop_ids}'
)
VEHICLE_LOCATIONS_URL = (
    NEXTBUS_API_PATH + '?command=vehicleLocations&a=' + AGENCY + '&r={route_id}&t=10000'
)
ROUTE_ETA_URL = (
    NEXTBUS_API_PATH + '?command=predictions&a=' + AGENCY + '&r={route_id}&s={stop_id}'
)

routes_json = requests.get(ROUTES_URL).json()
# import json
# routes_json = json.load(
#     open('/Users/glen/Dropbox/Code/busmap.io/app/scripts/sf-muni.json')
# )
routes = {}
for route in routes_json['route']:
    routes[route['tag']] = route


def get_stop_pt(stop):
    return shapely.geometry.Point([
        float(stop['lat']), float(stop['lon'])
    ])

stops = {}
for route in routes.values():
    for stop in route['stop']:
        stop_id = stop['tag']
        if stop_id not in stops:
            stop_obj = {}
            stop_obj.update(stop)
            stop_obj['pt'] = get_stop_pt(stop)
            stop_obj['route_ids'] = []
            stops[stop_id] = stop_obj

        stops[stop_id]['route_ids'].append(route['tag'])


def lat_lng_within_route(lat, lng, route):
    return all([
        lat >= float(route['latMin']),
        lat < float(route['latMax']),
        lng >= float(route['lonMin']),
        lng < float(route['lonMax']),
    ])


def get_routes_containing_pt(lat, lng):
    return [
        route for route in routes.values()
        if lat_lng_within_route(lat, lng, route)
    ]


def get_predictions_by_stop_ids(stop_ids):
    stop_id_str = '&'.join(['stops=' + stop_id for stop_id in stop_ids])
    url = PREDICTIONS_URL.format(stop_ids=stop_id_str)
    return requests.get(url).json()


def get_routes_by_nearby_stops_box(
    lat_min,
    lng_min,
    lat_max,
    lng_max
):
    box = shapely.geometry.box(
        lng_min, lat_min,
        lng_max, lat_max
    )
    return get_routes_by_nearby_stops_geom(box)


def get_routes_by_nearby_stops_lat_lng(lat, lng):
    pt = shapely.geometry.Point([lat, lng])
    return get_routes_by_nearby_stops_geom(pt)


def get_routes_by_nearby_stops_geom(geom):
    def stop_dist(stop):
        dist = stop['pt'].distance(geom)
        return dist

    nearby_stops = sorted(stops.values(), key=stop_dist)[:8]

    nearby_stop_ids = [stop['tag'] for stop in nearby_stops]

    stop_route_ids = []
    for stop_id in nearby_stop_ids:
        for route_id in stops[stop_id]['route_ids']:
            stop_route_ids.append('|'.join([route_id, stop_id]))

    prediction_resp = get_predictions_by_stop_ids(stop_route_ids)

    routes_by_stop = {}
    for prediction in prediction_resp['predictions']:
        if 'direction' not in prediction:
            continue
        stop_tag = prediction['stopTag']
        route_tag = prediction['routeTag']

        if stop_tag not in routes_by_stop:
            routes_by_stop[stop_tag] = []

        if isinstance(prediction['direction'], dict):
            directions = [prediction['direction']]
        else:
            directions = prediction['direction']
        for direction in directions:
            if isinstance(direction['prediction'], dict):
                direction_predictions = [direction['prediction']]
            else:
                direction_predictions = direction['prediction']

            for direction_prediction in direction_predictions:
                dir_tag = direction_prediction['dirTag']
                routes_by_stop[stop_tag].append((route_tag, dir_tag))

    nearby_route_ids = []
    nearby_route_id_stop_ids = []

    for stop_id in nearby_stop_ids:
        stop_routes = routes_by_stop.get(stop_id, [])
        for route_id, dir_id in stop_routes:
            if route_id not in nearby_route_ids:
                nearby_route_ids.append(route_id)
                nearby_route_id_stop_ids.append((route_id, stop_id))
            if len(nearby_route_ids) == 10:
                break

    return [
        (routes[route_id], stops[stop_id])
        for (route_id, stop_id) in nearby_route_id_stop_ids
    ]


def filter_stops_by_route_direction(route, route_direction_id):
    direction = [
        d for d in route['direction']
        if d['tag'] == route_direction_id
    ]
    if not direction:
        return []

    stop_ids_for_direction = set()
    for stop_with_tag in direction[0]['stop']:
        stop_ids_for_direction.add(stop_with_tag['tag'])

    return [
        stop for stop in route['stop']
        if stop['tag'] in stop_ids_for_direction
    ]


def get_stop_closest_to_lat_lng(route, route_direction_id, lat, lng):
    lat_lng_pt = shapely.geometry.Point([lat, lng])
    stops_by_distance = []
    for stop in filter_stops_by_route_direction(route, route_direction_id):
        distance = get_stop_pt(stop).distance(lat_lng_pt)
        stops_by_distance.append((stop, distance))
    stops_by_distance = sorted(
        stops_by_distance,
        key=lambda sd: sd[1]
    )
    closest_stop = next(iter(stops_by_distance), None)
    return closest_stop


def get_route_distance_to_lat_lng(route, lat, lng):
    lat_lng_pt = shapely.geometry.Point([lat, lng])
    return min([
        get_stop_pt(stop).distance(lat_lng_pt)
        for stop in route['stop']
    ])


def get_lat_lng_distance_to_lat_lng(lat1, lng1, lat2, lng2):
    return (
        shapely.geometry.Point([lat1, lng2])
        .distance(
            shapely.geometry.Point([lat2, lng2])
        )
    )


def get_vehicles_by_lat_lng_distance(route_id, route_direction_id, lat, lng):
    response = requests.get(VEHICLE_LOCATIONS_URL.format(route_id=route_id)).json()
    vehicles_by_distance = []

    vehicles = response.get('vehicle', [])
    if isinstance(vehicles, dict):
        vehicles = [vehicles]

    for vehicle_location in vehicles:
        if vehicle_location.get('routeTag') != route_id:
            # print 'Vehicle {} does not have route {}'.format(vehicle_location, route_id)
            continue
        if vehicle_location.get('dirTag') != route_direction_id:
            # print 'Vehicle {} does not have direction {}'.format(vehicle_location, route_direction_id)
            continue
        distance_to_lat_lng = get_lat_lng_distance_to_lat_lng(
            float(vehicle_location['lat']),
            float(vehicle_location['lon']),
            lat,
            lng
        )
        vehicles_by_distance.append(
            (vehicle_location, distance_to_lat_lng)
        )
    return sorted(
        vehicles_by_distance,
        key=lambda vehicle_distance: vehicle_distance[1]
    )


def get_predictions_by_route_and_stop(route_id, stop_id):
    url = ROUTE_ETA_URL.format(route_id=route_id, stop_id=stop_id)
    return requests.get(url).json()
