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


def get_predictions_by_stop_ids(stop_ids):
    stop_id_str = '&'.join(['stops=' + stop_id for stop_id in stop_ids])
    url = PREDICTIONS_URL.format(stop_ids=stop_id_str)
    return requests.get(url).json()


def get_routes_by_nearby_stops(
    lat_min,
    lng_min,
    lat_max,
    lng_max
):
    geom = shapely.geometry.box(
        lng_min, lat_min,
        lng_max, lat_max
    )

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
