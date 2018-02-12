function routeOnClick(route) {
    map.fire('routeClicked', {element: route, route: route.dataset});
}

function routesLoaded(routes) {
    var innerHTML = '';
    for (r = 0; r < routes.length; r++) {
        var route = routes[r];
        for (d = 0; d < route.directions.length; d++) {
            innerHTML += '<div data-route="' + route.tag + '" data-route-direction="' + route.directions[d].tag + '" data-stop="' + route.stop + '" class="stop" onclick="routeOnClick(this)">' +
                route.title + ': ' + route.directions[d].title +
            '</div>';
        }
    }
    document.getElementById('stops').innerHTML = innerHTML;
}

function latLngZoomToTileCoordinate(lat, lng, zoom) {
    return map.project([lat, lng], zoom).divideBy(256).floor();
}

function loadRoutes(lat, lng) {
    var xhttp = new XMLHttpRequest();
    xhttp.onreadystatechange = function() {
        if (this.readyState !== 4 || this.status !== 200) {
            return;
        }
        routesLoaded(JSON.parse(this.response).routes);
    };
    var coords = latLngZoomToTileCoordinate(lat, lng, window.TILE_ZOOM);

    var url = CLOSEST_ROUTES
        .replace('{agency}', window.AGENCY)
        .replace('{z}', window.TILE_ZOOM)
        .replace('{x}', coords.x)
        .replace('{y}', coords.y);
    xhttp.open("GET", url, true);
    xhttp.send();
}

window.mapMoved = false;
map.on('moveend', function () {
    window.mapMoved = true;
});

map.on('userLocationLoaded', function (data) {
    var location = data.location;
    var latlng = [location.coords.latitude, location.coords.longitude];
    if (!mapMoved) {
        map.setView(latlng);    
    }
});

map.on('moveend', function () {
    loadRoutes(map.getCenter().lat, map.getCenter().lng);
});
window.currentRoute = null;

map.on('routeClicked', function (data) {
    var url = getRouteVehicleUrl(
        data.route,
        null,
        map.getCenter().lat,
        map.getCenter().lng,
        map.getZoom()
    );
    window.location.href = url;
});
loadRoutes(map.getCenter().lat, map.getCenter().lng);


window.centerMarker = null;
function updateMarker() {
    if (!centerMarker) {
        centerMarker = L.marker(map.getCenter());
        centerMarker.addTo(map);
    }
    centerMarker.setLatLng(map.getCenter());
}
map.on('move', updateMarker);
updateMarker();


function reloader() {
    if (window.currentRoute) {
        map.fire('routeClicked', {route: window.currentRoute});
    }
}
setInterval(reloader, 10000);


function updateUserLocation(location) {
    console.log('location loaded', location);
    var latlng = [location.coords.latitude, location.coords.longitude];
    if (!window.userLocationMarker) {
        window.userLocationMarker = L.circleMarker(latlng, window.userLocationStyle);
        window.userLocationMarker.bindPopup('Your location');
        window.userLocationMarker.addTo(map);
    }
    else {
        window.userLocationMarker.setLatLng(latlng);
    }
    map.fire('userLocationLoaded', {location: location});
}
if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(updateUserLocation, function () {
        console.log('Could not load geolocation');
    });
}