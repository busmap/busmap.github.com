var url = new URL(window.location.href);

var currentRoute = {
    route: url.searchParams.get('routeId'),
    routeDirection: url.searchParams.get('routeDirectionId'),
}
var vehicleId = url.searchParams.get('vehicleId');
if (vehicleId) {
    window.selectedVehicleId = vehicleId;
}
var stopId = url.searchParams.get('stopId');
if (stopId) {
    window.originStopId = stopId;
}


function updateHelpMessage() {
    var helpElement = document.getElementById('help');
    var etaElement = document.getElementById('eta');
    if (window.selectedVehicleId && window.selectedStopId) {
        help.style.display = "none";
    }
    else if (window.selectedVehicleId) {
        help.innerHTML = "<em>Tap on your destination stop</em>";
        help.style.display = "block";
    }
    else {
        help.innerHTML = "<em>Tap on your bus</em>";
        help.style.display = "block";
    }
}
updateHelpMessage();
map.on('stopSelected', updateHelpMessage);
map.on('stopDeselected', updateHelpMessage);
map.on('etaRendered', updateHelpMessage);

function getVehiclePrediction(predictionResponse, vehicleId, routeDirectionId) {
    var directions = [];
    if (predictionResponse.predictions.direction) {
        if (Array.isArray(predictionResponse.predictions.direction)) {
            directions = predictionResponse.predictions.direction;
        }
        else {
            directions.push(predictionResponse.predictions.direction);
        }
    }
    var prediction = null;
    var vehicleId = window.selectedVehicleId;
    for (var i = 0; i < directions.length; ++i) {
        var direction = directions[i];
        var predictions = direction.prediction;
        if (!Array.isArray(predictions)) {
            predictions = [predictions];
        }
        for (var j = 0; j < predictions.length; ++j) {
            var prediction = predictions[j];
            if (prediction.dirTag == routeDirectionId) {
                if (!vehicleId) {
                    return prediction;
                }
                else if (prediction.vehicle == vehicleId) {
                    return prediction;
                }
            }
        }
    }
    return null;
}

function loadEta(routeId, routeDirectionId, stopId) {
    // load eta for stop/vehicle
    var url = VEHICLE_ETA
        .replace('{agency}', window.AGENCY)
        .replace('{route_id}', routeId)
        .replace('{stop_id}', stopId);

    loadUrl(url, function (response) {
        if (!response) {
            map.fire('noEtaLoaded');
            return;
        }
        var vehiclePrediction = getVehiclePrediction(response, window.selectedVehicleId, routeDirectionId);
        var minutes = null;
        var seconds = null;
        var pretty = null;
        if (vehiclePrediction) {
            minutes = parseInt(vehiclePrediction.minutes);
            seconds = parseInt(vehiclePrediction.seconds) - (60 * minutes);
            pretty = minutes + 'm ' + seconds + 's';
        }
        map.fire('etaLoaded', {
            minutes: minutes,
            seconds: seconds,
            pretty: pretty
        });
    });
}
function alignMap() {
    if (window.selectedVehicleId && !window.vehicleMarkers[window.selectedVehicleId]) {
        map.once('vehiclesRendered', alignMap);
        return;
    }
    if (window.selectedStopId && !window.stopMarkers[window.selectedStopId]) {
        map.once('routeLayerLoaded', alignMap);
        return;
    }
    if (window.selectedVehicleId) {
        var vehicleLatLng = window.vehicleMarkers[window.selectedVehicleId].getLatLng();

        if (window.selectedStopId) {
            var stopLatLng = window.stopMarkers[window.selectedStopId].getLatLng();    
            // create bounds between stop / vehicle
            var markerVehicleBounds = L.latLngBounds(stopLatLng, vehicleLatLng).pad(.10);
            map.fitBounds(markerVehicleBounds);
        } else {
            map.setView(vehicleLatLng, 15);
        }
    }
}

function loadClosestStop(routeId, routeDirectionId, lat, lng, callback) {
    var latLng = L.latLng([lat, lng]);

    var url = ROUTE
        .replace('{agency}', AGENCY)
        .replace('{route_id}', routeId);
    loadUrl(url, function (response) {
        var stops = filterStopsByRouteDirection(response.route, routeDirectionId);
        var closestDistance = null;
        var closestStop = null;
        for (var i = 0; i < stops.length; ++i) {
            var stop = stops[i];
            var stopLatLng = L.latLng([
                parseFloat(stop.lat),
                parseFloat(stop.lon)
            ]);
            var stopDistance = latLng.distanceTo(stopLatLng);
            if (!closestDistance || stopDistance < closestDistance) {
                closestDistance = stopDistance;
                closestStop = stop;
            }
        }
        callback(closestStop);

        // callback(response.stop);
    });
}
map.on('stopSelected', function (data) {
    // disable stop selection if vehicle not selected
    if (!window.selectedVehicleId) {
        return;
    }
    if (window.selectedStopId && window.stopMarkers[window.selectedStopId]) {
        var previousStopMarker = window.stopMarkers[window.selectedStopId];
        
        if (window.selectedStopId === data.stop.tag && data.clicked) {
            window.selectedStopId = null;
            map.fire('stopDeselected', {stop: previousStopMarker.stop, clicked: data.clicked});
            return;
        }
        map.fire('stopDeselected', {stop: previousStopMarker.stop, clicked: data.clicked});
    }
    window.selectedStopId = data.stop.tag;

    if (window.stopMarkers[window.selectedStopId]) {
        window.stopMarkers[window.selectedStopId].setStyle(window.selectedStopStyle);
    }
    
    loadEta(currentRoute.route, currentRoute.routeDirection, window.selectedStopId, window.selectedVehicleId);

    if (data.clicked) {
        saveHash(window.selectedStopId);
        updateHelpMessage();
    }
});
map.on('stopDeselected', function (data) {
    window.stopMarkers[data.stop.tag].setStyle(window.defaultStopStyle);

    var etaElement = document.getElementById('eta');    
    etaElement.innerHTML = '';

    if (data.clicked) {
        saveHash(null);
    }
});
map.on('routeLayerLoaded', function () {
    if (window.selectedStopId) {
        var stopMarker = window.stopMarkers[window.selectedStopId];
        map.fire('stopSelected', {stop: stopMarker.stop});    
    }
    
});
map.on('etaLoaded', function (data) {
    console.log('eta ' + data.pretty);

    var stopMarker = window.stopMarkers[window.selectedStopId];
    if (!stopMarker) {
        return;
    }
    var etaString = stopMarker.stop.title + ': ' + data.pretty;

    var etaElement = document.getElementById('eta');    
    etaElement.innerHTML = etaString;
    map.fire('etaRendered');
});
map.on('noEtaLoaded', function () {
    console.log('No eta');

    var etaElement = document.getElementById('eta');    
    etaElement.innerHTML = 'N/A';
})
function hideRouteStopsBeforeVehicle(vehicle) {
    loadClosestStop(
        currentRoute.route,
        currentRoute.routeDirection,
        vehicle.lat,
        vehicle.lng,
        function (stop) {
            // hide all stops before this stop in the route
            if (!window.route) {
                return;
            }
            for (currentStop of window.route.features) {
                if (currentStop.properties.tag === stop.tag) {
                    break;
                }
                if (window.stopMarkers[currentStop.properties.tag]) {
                    window.stopMarkers[currentStop.properties.tag].removeFrom(map);
                }
            }
        }
    );
}
map.on('vehiclesLoaded', function (data) {
    var vehicles = data.vehicles;
    for (vehicle of vehicles) {
        if (!window.selectedVehicleId || vehicle.id === window.selectedVehicleId) {
            renderVehicle(vehicle);
        }
        if (vehicle.id === window.selectedVehicleId) {
            hideRouteStopsBeforeVehicle(vehicle);
        }
    }
    map.fire('vehiclesRendered');
    if (window.selectedStopId) {
        loadEta(currentRoute.route, currentRoute.routeDirection, window.selectedStopId, window.selectedVehicleId);    
    }
});
map.on('routeLoaded', function (data) {
    var routeString = [data.route.properties.title, data.route.properties.direction].join(': ');
    var routeNameElement = document.getElementById('routeName');
    routeNameElement.innerHTML = '<strong>' + routeString + '</strong>';

    if (window.selectedVehicleId) {
        var vehicleIdElement = document.getElementById('vehicleId');
        vehicleIdElement.innerHTML = '(Vehicle&nbsp;' + window.selectedVehicleId + ')';
    }
});
map.on('vehicleClicked', function (data) {
    var vehicleId = data.vehicle.id;
    var url = getRouteVehicleUrl(currentRoute, vehicleId);
    window.location.href = url;
})

function reloader() {
    loadVehicles(currentRoute.route, currentRoute.routeDirection);
}
window.intervalId = setInterval(reloader, 10000);
reloader();

loadRoute(currentRoute.route, currentRoute.routeDirection);
alignMap();