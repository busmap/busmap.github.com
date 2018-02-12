window.AGENCY = 'sf-muni';
window.TILE_ZOOM = 16;

window.CLOSEST_ROUTES = '/static/tiles/{agency}/{z}/{x}/{y}.json'
window.CLOSEST_STOP = '/api/closest_stop';

window.API_URL = 'http://webservices.nextbus.com/service/publicJSONFeed';
window.VEHICLES = API_URL + '?command=vehicleLocations&a={agency}&r={route_id}&t=10000';
window.VEHICLE_ETA = API_URL + '?command=predictions&a={agency}&r={route_id}&s={stop_id}';
window.ROUTE = API_URL + '?command=routeConfig&a={agency}&r={route_id}';

window.busIconUrl = '/static/bus.png';

window.map = L.map('map');
var tileLayer = L.tileLayer('https://api.tiles.mapbox.com/v4/{id}/{z}/{x}/{y}@2x.png?access_token={accessToken}', {
    maxZoom: 18,
    id: 'mapbox.streets',
    accessToken: 'pk.eyJ1IjoiZ2xlbnJvYmVydHNvbiIsImEiOiJjaXQ5N3M3aGUwa2FpMnRwMWdtbmdjNzJnIn0.MUb0axgXFx6ZpoWVZaRQWA'
});
tileLayer.addTo(map);

map.attributionControl.setPrefix(false);
map.attributionControl.addAttribution('Map data &copy; <a href="http://openstreetmap.org">OpenStreetMap</a> contributors, <a href="http://creativecommons.org/licenses/by-sa/2.0/">CC-BY-SA</a>, Imagery © <a href="http://mapbox.com">Mapbox</a>');;

window.defaultStopStyle = {
    radius: 8,
    fillColor: "#CC2222",
    color: "#811",
    weight: 1,
    fillOpacity: 0.8
};
window.selectedStopStyle = {
    radius: 8,
    fillColor: "#00CC78",
    color: "#087",
    weight: 1,
    fillOpacity: 0.8
};
window.userLocationStyle = {
    radius: 4,
    fillColor: "#0078DD",
    color: "#00F",
    weight: 1,
    fillOpacity: 0.8  
};

window.vehicleMarkers = {};
window.stopMarkers = {};
window.userLocationMarker = null;
window.originStopId = null;
window.selectedStopId = null;
window.selectedVehicleId = null;

var url = new URL(window.location.href);
var lat = url.searchParams.get('lat');
var lng = url.searchParams.get('lng');
var zoom = url.searchParams.get('zoom');
if (lat && lng && zoom) {
    window.center = L.latLng(parseFloat(lat), parseFloat(lng));
    window.zoom = parseInt(zoom);
}

function loadUrl(url, callback) {
    var xhttp = new XMLHttpRequest();
    xhttp.onreadystatechange = function() {
        if (this.readyState !== 4 || this.status !== 200) {
            return;
        }
        callback(JSON.parse(this.response));
    };
    xhttp.open("GET", url, true);
    xhttp.send();
}
function loadHash() {
    var hash = window.location.hash.substring(1);
    window.selectedStopId = hash;
}
function saveHash(selectedStopId) {
    if (selectedStopId === null) {
        // clear hash
        history.pushState("", document.title, window.location.pathname
                                               + window.location.search);
    }
    else {
        window.location.hash = selectedStopId;    
    }
    
}
function getRouteVehicleUrl(route, vehicleId, lat, lng, zoom) {
    var url = 'http://' + window.location.host + '/route.html';
    url += '?routeId=' + route.route;
    url += '&routeDirectionId=' + route.routeDirection;
    if (vehicleId) {
        url += '&vehicleId=' + vehicleId;
    }
    if (lat && lng && zoom) {
        url += '&lat=' + lat;
        url += '&lng=' + lng;
        url += '&zoom=' + zoom;
    }
    if (window.location.hash) {
        url += window.location.hash;
    }
    return url;
}
function renderVehicle(vehicle) {
    // initialize marker
    var marker = null;
    if (!vehicleMarkers.hasOwnProperty(vehicle.id)) {

        var iconUrl = busIconUrl;
        marker = vehicleMarkers[vehicle.id] = L.marker(
            [vehicle.lat, vehicle.lng],
            {icon: L.icon({iconUrl: iconUrl, iconSize: [30, 30]})}
        );
        marker.addTo(map);
    } else {
        marker = vehicleMarkers[vehicle.id];
    }
    // update location
    marker.setLatLng([vehicle.lat, vehicle.lng]);
    marker.on('click', function () {
        map.fire('vehicleClicked', {
            vehicle: vehicle,
            marker: this
        }
    )});
}
function renderVehicles(vehicles) {
    clearVehicles();
    vehicles.forEach(renderVehicle);
}
function clearVehicle(vehicle) {
    if (vehicleMarkers[vehicle.id]) {
        map.removeLayer(vehicleMarkers[vehicle.id]);
        delete vehicleMarkers[vehicle.id];
    }
}
function clearVehicles() {
    for (var k in vehicleMarkers) {
        clearVehicle({id: k});
    }
}
function getDirection(routeResponse) {
    var directions = [];
    if (routeResponse.direction) {
        if (Array.isArray(routeResponse.direction)) {
            directions = routeResponse.direction;
        }
        else {
            directions.push(routeResponse.direction);
        }
    }
    var direction = null;
    for(var i = 0; i < directions.length; ++i) {
        var currentDirection = directions[i];
        if (currentDirection.tag == routeDirectionId) {
            return currentDirection;
        }
    }
    return null;
}
function filterStopsByRouteDirection(route, routeDirectionId) {
    var direction = [];
    if (route.direction) {
        for (var i = 0; i < route.direction.length; ++i) {
            var currentDirection = route.direction[i];
            if (currentDirection.tag == routeDirectionId) {
                direction.push(currentDirection);
            }
        }
    }
    if (direction.length == 0) {
        return direction;
    }
    var stops = direction[0].stop;
    var stopTags = [];
    for (var j = 0; j < stops.length; ++j) {
        var stop = stops[j];
        if (!stopTags.includes(stop.tag)) {
            stopTags.push(stop.tag);
        }
    }
    var filteredStops = [];
    if (route.stop) {
        for (var k = 0; k < route.stop.length; ++k) {
            var stop = route.stop[k];
            if (stopTags.includes(stop.tag)) {
                filteredStops.push(stop);
            }
        }    
    }
    return filteredStops;
}
function loadRoute(routeId, routeDirectionId) {
    var url = ROUTE
        .replace('{agency}', AGENCY)
        .replace('{route_id}', routeId);
    loadUrl(url, function (response) {
        var direction = getDirection(response);
        var stops = filterStopsByRouteDirection(response.route, routeDirectionId);
        var geojson = {
            type: 'FeatureCollection',
            features: [],
            properties: {
                title: response.route.title,
                direction: direction ? direction.name : null
            }
        };
        for (var i = 0; i < stops.length; ++i) {
            var stop = stops[i];
            var feature = {
                type: 'Point',
                coordinates: [
                    parseFloat(stop.lon), parseFloat(stop.lat)
                ],
                properties: {
                    tag: stop.tag,
                    title: stop.title
                }
            };
            geojson.features.push(feature);
        }
        map.fire('routeLoaded', {route: geojson});
    });
}
function loadVehicles(routeId, routeDirectionId) {
    console.log('loading vehicles for route ' + routeId + ' ' + routeDirectionId);
    var center = map.getCenter();

    var url = VEHICLES
        .replace('{agency}', AGENCY)
        .replace('{route_id}', routeId);
    loadUrl(url, function (response) {
        var out = [];
        // filter by direction, and calculate distance to center
        for(var i = 0; i < response.vehicle.length; ++i) {
            var vehicle = response.vehicle[i];
            if (vehicle.routeTag != routeId) {
                continue;
            }
            if (vehicle.dirTag != routeDirectionId) {
                continue;
            }
            var vehicleLatLng = L.latLng([
                parseFloat(vehicle.lat),
                parseFloat(vehicle.lon)
            ]);

            out.push({
                id: vehicle.id,
                lat: vehicleLatLng.lat,
                lng: vehicleLatLng.lng,
                same_direction: vehicle.dirTag == routeDirectionId,
                distance: vehicleLatLng.distanceTo(center)
            })
        }

        map.fire('vehiclesLoaded', {vehicles: out});
    })
}
map.on('routeLoaded', function (data) {
    if (window.routeLayer) {
        routeLayer.removeFrom(map);
    }
    if (!window.stopMarkers) {
        window.stopMarkers = {};
    }
    window.route = data.route;
    window.routeLayer = L.geoJSON(data.route, {
         pointToLayer: function (feature, latlng) {
            var marker = L.circleMarker(latlng, window.defaultStopStyle);
            marker.stop = feature.properties;
            window.stopMarkers[feature.properties.tag] = marker;
            marker.on('click', function() {
                map.fire('stopSelected', {
                    stop: feature.properties,
                    clicked: true
                });
            });
            return marker;
        }
    });
    routeLayer.on('add', function () {
        map.fire('routeLayerLoaded', {routeLayer: routeLayer});
    });
    routeLayer.addTo(map);
});

if(window.center && window.zoom) {
    map.setView(window.center, window.zoom);
} else {
    map.setView([37.7666, -122.41189], 14);    
}

if (window.location.hash) {
    loadHash();
}