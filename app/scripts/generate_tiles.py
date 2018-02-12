import os
import shutil
import json

import requests
import shapely.geometry
import mercantile

from app.services import nextbus


def get_bounds(route_config_payload):
    routes = route_config_payload['route']
    print('{} routes found'.format(len(routes)))

    points = []
    for route in routes:
        points.append(
            (float(route['lonMin']), float(route['latMin']))
        )
        points.append(
            (float(route['lonMax']), float(route['latMax']))
        )

    return shapely.geometry.MultiPoint(points).bounds


def get_tile_coordinates(bounds, zoom):
    print('Getting tile coordinates for bounds {}'.format(bounds))
    zooms = [zoom]
    west, south, east, north = bounds
    return mercantile.tiles(west, south, east, north, zooms, truncate=False)


def get_route_tile(x, y, z):
    west, south, east, north = mercantile.bounds(
        mercantile.Tile(x, y, z)
    )
    print 'Bounds {} {} {} {}'.format(west, south, east, north)
    routes = nextbus.get_routes_by_nearby_stops(
        east, south, east, north
    )
    return {'routes': [
        {
            'tag': route.get('tag'),
            'stop': stop.get('tag'),
            'title': route.get('title'),
            'directions': [
                {
                    'tag': direction['tag'],
                    'title': direction.get('title'),
                    'name': direction.get('name'),
                }
                for direction in route.get('direction', [])
                if isinstance(direction, dict)
            ]
        }
        for route, stop
        in routes
    ]}


def process_route_tiles(path, tile_coordinates):
    if os.path.exists(path):
        print 'Wiping directory {}'.format(path)
        shutil.rmtree(path)

    for tile_coordinate in tile_coordinates:
        x, y, z = tile_coordinate.x, tile_coordinate.y, tile_coordinate.z
        print 'Processing routes for tile coordinate {x}/{y}/{z}'.format(
            x=x, y=y, z=z
        )
        payload = json.dumps(get_route_tile(x, y, z))

        y_path = '{path}/{z}/{x}'.format(path=path, z=z, x=x)
        if not os.path.exists(y_path):
            print 'Creating directory {}'.format(y_path)
            os.makedirs(y_path)

        filename = '{path}/{z}/{x}/{y}.json'.format(path=path, z=z, x=x, y=y)
        with open(filename, 'w') as tile_file:
            tile_file.write(payload)


agency = 'sf-muni'
agency_url = (
    'http://webservices.nextbus.com/service/publicJSONFeed'
    '?command=routeConfig'
    '&a={agency}'.format(agency=agency)
)
print('Requesting {}'.format(agency_url))
response = requests.get(agency_url)
route_config_payload = response.json()

bounds = get_bounds(route_config_payload)
print 'Bounds {}'.format(bounds)

tile_coordinates = get_tile_coordinates(bounds, zoom=16)
print 'Tile coordinates {}'.format(tile_coordinates)

path = 'static/tiles/{agency}'.format(agency=agency)
process_route_tiles(path, tile_coordinates)
