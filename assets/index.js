var STATUS_FETCH_INTERVAL = 1000;
var GENERIC_ERROR = "An error has occurred";
var ID_COOKIE = "hunt-club-id";
var TOKEN_COOKIE = "hunt-club-token";

var circleDiameterPercent;
var statusTimeout;
var statusFetchCount = 0;
var mapId;
var locations = {};
var currentDrawStatus = {};
var nextDrawStatus = {};

window.addEventListener('load', function() {

    loadMap();
    setupLogin();
    setupDrawing();

});

/**
 * Setup the drawing section.
 */
function setupDrawing() {
    document.querySelectorAll("#enter-next, #exit-next").forEach( function(el) {
        el.onclick = function() {
            makeRequest("POST", "/drawing", {}, function(text) {
                createToast( el.getAttribute("id") === "enter-next" ? "Drawing entered" : " Drawing exited" );
                fetchStatus();
            }, errorToast);
        }
    });
    
    // skip button
    document.querySelector("#skip").onclick = function() {
        makeRequest("POST", "/skip", {}, function() {
            createToast("Skipped spot");
        }, errorToast);
    }
}

/**
 * Setup the login section.
 */
function setupLogin() {
    var idCookie = getCookie(ID_COOKIE);
    var tokenCookie = getCookie(TOKEN_COOKIE);
    if( !idCookie || !tokenCookie ) {
        deleteCookie(ID_COOKIE);
        deleteCookie(TOKEN_COOKIE);
        document.querySelector("#logout-section").classList.add("hidden");
        document.querySelector("#login-section").classList.remove("hidden");
        document.querySelector("#user-name").innerText = "";
        document.querySelectorAll(".box").forEach( function(el) {
            el.parentElement.removeChild(el);
        });
    }
    else {
        document.querySelector("#login-section").classList.add("hidden");
        document.querySelector("#logout-section").classList.remove("hidden");
        var info = JSON.parse(decodeURIComponent(idCookie));
        document.querySelector("#user-name").innerText = info.name;
    }

    document.querySelector("#login").onclick = function(e) {
        e.preventDefault();
        var email = document.querySelector("#email");
        var password = document.querySelector("#password");
        var emailValue = email.value;
        var passwordValue = password.value;
        email.value = "";
        password.value = "";
        makeRequest("POST", "/login", {
            email: emailValue,
            password: passwordValue
        }, function(text) {
            createToast("Logged in");
            setupLogin();
        }, errorToast);
    }
    document.querySelector("#logout").onclick = function(e) {
        e.preventDefault();
        deleteCookie(ID_COOKIE);
        deleteCookie(TOKEN_COOKIE);
        setupLogin();
    }
}

/**
 * Load the Map.
 */
function loadMap() {
    var url = new URL(window.location.href);
    mapId = url.searchParams.get("map");
    makeRequest("GET", "/map", { mapId: mapId }, function(text) {
        var json = JSON.parse(text);
        circleDiameterPercent = json.map.circle_diameter;
        var img = document.createElement("img");
        img.setAttribute("src", json.map.image_src);
        img.setAttribute("alt", json.map.name + " Map");
        document.querySelector("#map").appendChild(img);
        document.title = json.map.name + ": " + document.title;
        var h1 = document.querySelector("h1");
        h1.innerText = json.map.name + ": " + h1.innerText;

        addDeveloperHelper();
        fetchStatus(); // start fetching status
    }, errorToast);    
}

/**
 * Add the developer click helper for creating new map positions.
 */
function addDeveloperHelper() {
    // HELPER
    var img = document.querySelector("img");
    // helps for creating the boxes
    img.onclick = function(e) {
        var width = img.offsetWidth;
        var height = img.offsetHeight;
        var diameter = circleDiameterPercent * width;
        var radius = diameter/2;
        // top left - you click on the center
        var box = [(e.offsetX-radius)/width,(e.offsetY-radius)/height];
        console.log(box);
        console.log(e.offsetX, e.offsetY, width, height);
    }
}

/**
 * Update the current status.
 */
function fetchStatus() {
    clearTimeout(statusTimeout); // if directly called
    statusFetchCount++;
    var myCallStatusFetchCount = statusFetchCount;
    if( !getCookie(TOKEN_COOKIE) ) { // don't make unecessary requests
        statusTimeout = setTimeout(fetchStatus, STATUS_FETCH_INTERVAL);
        return;
    }
    makeRequest("GET", "/status", { mapId: mapId }, function(text) {
        if(statusFetchCount !== myCallStatusFetchCount) return; // this is when we fetch after punching, if we get the results back for an interval while waiting for a punch fetch, ignore the interval, since it was called before the punch
        var json = JSON.parse(text);
        var prevLocations = locations;
        locations = json.locations;
        var prevCurrentDrawStatus = currentDrawStatus;
        var prevNextDrawStatus = nextDrawStatus;
        currentDrawStatus = json.currentDrawStatus;
        nextDrawStatus = json.nextDrawStatus;
        statusTimeout = setTimeout(fetchStatus, STATUS_FETCH_INTERVAL);
        window.onresize = addBoxes;
        if( JSON.stringify(locations) !== JSON.stringify(prevLocations) ) {
            addBoxes(); // redraw
        }
        if( JSON.stringify(prevCurrentDrawStatus) !== JSON.stringify(currentDrawStatus) || JSON.stringify(prevNextDrawStatus) !== JSON.stringify(nextDrawStatus) ) {
            addDraws();
        }
    }, function(err) {
        if(statusFetchCount !== myCallStatusFetchCount) return;
        console.log(err);
        statusTimeout = setTimeout(fetchStatus, STATUS_FETCH_INTERVAL);
    });
}

/**
 * Add drawing information.
 */
function addDraws() {
    var currentDrawingSection = document.querySelector("#current-drawing-section");
    var currentDrawingPlace = currentDrawingSection.querySelector("#current-drawing-place");
    var currentDrawingOn = currentDrawingSection.querySelector("#current-drawing-on");
    var currentDrawingTimeLeft = currentDrawingSection.querySelector("#current-drawing-time-left");
    var skip = currentDrawingSection.querySelector("#skip");
    if( currentDrawStatus.drawHappening ) {
        currentDrawingPlace.innerText = (currentDrawStatus.drawOrder !== null) ? (currentDrawStatus.drawOrder + 1) : "Not Entered";
        currentDrawingOn.innerText = currentDrawStatus.drawOn + 1;
        currentDrawingTimeLeft.innerText = currentDrawStatus.drawSecondsLeft;
        currentDrawingSection.classList.remove("hidden");
        if( currentDrawStatus.drawOn === currentDrawStatus.drawOrder ) {
            currentDrawingSection.classList.add("your-draw");
            skip.classList.remove("hidden");
        }
        else {
            currentDrawingSection.classList.remove("your-draw");
            skip.classList.add("hidden");
        }
    }
    else {
        currentDrawingPlace.innerText = "";
        currentDrawingOn.innerText = "";
        currentDrawingTimeLeft.innerText = "";
        currentDrawingSection.classList.add("hidden");
        currentDrawingSection.classList.remove("your-draw");
        skip.classList.add("hidden");
    }

    var enterNext = document.querySelector("#enter-next");
    var exitNext = document.querySelector("#exit-next");
    if( nextDrawStatus.inNextDraw ) {
        enterNext.classList.add("hidden");
        exitNext.classList.remove("hidden");
    }
    else {
        exitNext.classList.add("hidden");
        enterNext.classList.remove("hidden");
    }
}

/**
 * Add boxes.
 */
function addBoxes() {
    var boxElements = document.querySelectorAll(".box"); // order should be the same so we can reuse
    var img = document.querySelector("img");
    var map = document.querySelector("#map");
    var width = img.offsetWidth;
    var height = img.offsetHeight;
    var diameter = circleDiameterPercent * width;
    var locationIds = Object.keys(locations);
    for( var i=0; i<locationIds.length; i++ ) {
        var location = locations[locationIds[i]];
        var boxElement;
        if( boxElements.length ) {
            boxElement = boxElements[i];
            var prevPopout = boxElement.querySelector(".popout"); 
            if( prevPopout ) {
                prevPopout.parentElement.removeChild(prevPopout);
                createPopout(location, boxElement);
            } ;
        }
        else {
            boxElement = document.createElement("div");
            boxElement.classList.add("box");
        }
        boxElement.setAttribute("style", "left:" + location.location.x*width + "px;top:" + location.location.y*height + "px;width:" + diameter + "px;height:" + diameter + "px;");
        if( location.user.id ) boxElement.classList.add("box-taken");
        else boxElement.classList.remove("box-taken");
        boxElement.onclick = (function(location, boxElement) {
            return function(e) {
                if( !boxElement.querySelector(".popout") ) createPopout(location, boxElement);
                e.stopPropagation();
            }
        })(location, boxElement);
        map.appendChild(boxElement);
    }
}

/**
 * Create a popout.
 * @param {Object} location - The location object.
 * @param {HTMLElement} boxElement - The box element.
 */
function createPopout(location, boxElement) {
    document.body.click(); // get rid of the previous popup
    var popout = document.createElement("div");
    popout.classList.add("popout");
    var popoutTitle = document.createElement("div");
    popoutTitle.classList.add("popout-title");
    popoutTitle.innerText = location.location.name;
    popout.appendChild(popoutTitle);
    if( location.user.id ) {
        var popoutName = document.createElement("div");
        popoutName.classList.add("popout-name");
        popoutName.innerText = location.user.name;
        popout.appendChild(popoutName);
        var popoutPhone = document.createElement("div");
        popoutPhone.classList.add("popout-phone");
        popoutPhone.innerText = location.user.phone;
        popout.appendChild(popoutPhone);
    }
    
    var punch = document.createElement("button");
    punch.innerText = "Punch";
    punch.onclick = function() {
        makeRequest("POST", "/check", {
            locationId: location.location.id
        }, function(text) {
            createToast("Punch Successful");
            fetchStatus(); // only fetch if we aren't already
        }, errorToast);
    }
    popout.appendChild(punch);
    boxElement.appendChild(popout);
    document.body.onclick = function() {
        try {
            popout.parentElement.removeChild(popout);
        }
        catch(err) {}
    }
}

/**
 * Make a request.
 * @param {string} type - "GET" or "POST".
 * @param {string} url - The url to make the request to.
 * @param {object} parameters - An object with keys being parameter keys and values being parameter values to send with the request.
 * @param {function} callback - Callback function to run upon request completion.
 * @param {boolean} useFormData - True if we should use form data instead of json.
 */
function makeRequest(type, url, parameters, callback, errorCallback, useFormData) {
    var parameterKeys = Object.keys(parameters);

    //url = "http://" + window.location.hostname + url;
    if( (type == "GET" || type == "DELETE") && parameterKeys.length ) {
        var parameterArray = [];
        for( var i=0; i<parameterKeys.length; i++ ) {
            parameterArray.push( parameterKeys[i] + "=" + parameters[parameterKeys[i]] );
        }
        url = url + (url.match(/\?/) ? "&" : "?") + parameterArray.join("&");
    }
   
    var xhttp = new XMLHttpRequest();
    xhttp.open(type, url, true);

    if( (type != "GET" && type != "DELETE") && parameterKeys.length ) {
        if( !useFormData ) {
            xhttp.setRequestHeader("Content-type", "application/json");
        }
    }

    xhttp.onreadystatechange = function() {
        if( this.readyState == 4 ) {
            if( this.status == 200 ) {
                if( callback ) { callback(this.responseText); }
            }
            else {
                if( errorCallback ) { errorCallback(this.responseText); }
            }
        }
    }    
    if( (type != "GET" && type != "DELETE") && Object.keys(parameters).length ) {
        var sendParameters;
        if( useFormData ) {
            sendParameters = new FormData();
            for ( var key in parameters ) {
                sendParameters.append(key, parameters[key]);
            }
        }
        else {
            sendParameters = JSON.stringify(parameters);
        }
        xhttp.send( sendParameters );
    }
    else {
        xhttp.send();
    }
}

/**
 * Create a toast.
 * @param {string} message - The message to display in the toast.
 * @param {string} [type] - The type of toast (success or failure).
 * @param {boolean} [html] - True if the message is in HTML.
 */
function createToast(message, type, html) {
    var toast = document.createElement("div");
    toast.classList.add("toast");
    if( html ) toast.innerHTML = message;
    else toast.innerText = message;
    var appendElement = document.body;
    appendElement.appendChild(toast);
    setTimeout( function() { // Timeout for opacity
        toast.classList.add("toast-shown");
        setTimeout( function() { // Timeout until hiding
            toast.classList.remove("toast-shown");
            setTimeout( function() { // Timeout until removing
                toast.parentElement.removeChild(toast);
            }, 500 ); // Make sure this matches the css
        }, 4000 )
    }, 0 ); // Set timeout to add the opacity transition
}

/**
 * Standard error toast response from a request.
 * @param {string} text - The response text
 */
function errorToast(text) {
    try {
        var json = JSON.parse(text);
        if( json.message ) createToast(json.message);
        else createToast(GENERIC_ERROR)
    }
    catch(err) {
        createToast(GENERIC_ERROR);
    };
}

/**
 * Remove a cookie.
 * @param {string} name - The name of the cookie to remove.
 */
function deleteCookie(name) {
    document.cookie = name +'=; Path=/; Expires=Thu, 01 Jan 1970 00:00:01 GMT;';
}

/**
 * Get a cookie.
 * @param {string} a - The name of the cookie. 
 */
function getCookie(a) {
    var b = document.cookie.match('(^|;)\\s*' + a + '\\s*=\\s*([^;]+)');
    return b ? b.pop() : '';
}