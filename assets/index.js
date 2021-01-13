var CIRCLE_DIAMETER_PERCENT = 18/1208; // this is the diameter of the circles - it is a percentage of the width of the image
var STATUS_FETCH_INTERVAL = 1000;
var GENERIC_ERROR = "An error has occurred";

var boxes = [
    {
        name: "1B",
        points: [0.2907350993377483, 0.19740229885057472]
    },
    {
        name: "2B",
        points: [0.3294701986754967, 0.28991060025542786]
    },
    {
        name: "3B",
        points: [0.4478476821192053, 0.27458492975734355]
    },
    {
        name: "4B",
        points: [0.49503311258278143, 0.23116219667943805]
    },
    {
        name: "5B",
        points: [0.25, 0.39208173690932313]
    },
    {
        name: "6B",
        points: [0.3445430463576159, 0.3956360153256705]
    },
    {
        name: "7B",
        points: [0.43625827814569534, 0.3895274584929757]
    },
    {
        name: "8B",
        points: [0.1804635761589404, 0.5019157088122606]
    },
    {
        name: "9B",
        points: [0.27483443708609273, 0.4789272030651341]
    },
    {
        name: "10B",
        points: [0.38079470198675497, 0.5095785440613027]
    },
    {
        name: "11B",
        points: [0.45795364238410596, 0.4671558109833972]
    },
    {
        name: "12B",
        points: [0.271523178807947, 0.6679438058748404]
    },
    {
        name: "13B",
        points: [0.304635761589404, 0.6309067688378033]
    },
    {
        name: "14B",
        points: [0.36258278145695366, 0.6130268199233716]
    },
    {
        name: "15B",
        points: [0.3667218543046358, 0.7215836526181354]
    },
    {
        name: "16B",
        points: [0.4470198675496689, 0.7445721583652618]
    },
    {
        name: "17B",
        points: [0.18543046357615894, 0.5593869731800766]
    },
    {
        name: "19B",
        points: [0.34519867549668876, 0.7471264367816092]
    },
    {
        name: "20B",
        points: [0.31539735099337746, 0.789272030651341]
    },
    {
        name: "21B",
        points: [0.23841059602649006, 0.7369093231162197]
    },
    {
        name: "22B",
        points: [0.1870860927152318, 0.6283524904214559]
    }
];
var statusTimeout;
var locations = {};

window.addEventListener('load', function() {

    fetchStatus();
    addBoxes();
    window.onresize = addBoxes;
    var name = document.querySelector("#name");
    name.oninput = function() {
        window.localStorage.huntClubName = name.value;
    }
    if( window.localStorage.huntClubName ) {
        name.value = window.localStorage.huntClubName;
    }

    // HELPER
    var img = document.querySelector("img");
    // helps for creating the boxes
    img.onclick = function(e) {
        var width = img.offsetWidth;
        var height = img.offsetHeight;
        var diameter = CIRCLE_DIAMETER_PERCENT * width;
        var radius = diameter/2;
        // top left - you click on the center
        var box = [(e.offsetX-radius)/width,(e.offsetY-radius)/height];
        console.log(box);
    }
});

/**
 * Update the current status.
 */
function fetchStatus() {
    makeRequest("GET", "/status", {}, function(text) {
        locations = JSON.parse(text).locations;
        setTimeout(fetchStatus, STATUS_FETCH_INTERVAL);
        addBoxes(); // redraw
    }, function(err) {
        console.log(err);
        setTimeout(fetchStatus, STATUS_FETCH_INTERVAL);
    });
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
    var diameter = CIRCLE_DIAMETER_PERCENT * width;
    for( var i=0; i<boxes.length; i++ ) {
        var box = boxes[i];
        var boxElement;
        if( boxElements.length ) {
            boxElement = boxElements[i];
            var prevPopout = boxElement.querySelector(".popout"); 
            if( prevPopout ) {
                prevPopout.parentElement.removeChild(prevPopout);
                createPopout(box, boxElement);
            } ;
        }
        else {
            boxElement = document.createElement("div");
            boxElement.classList.add("box");
        }
        boxElement.setAttribute("style", "left:" + box.points[0]*width + "px;top:" + box.points[1]*height + "px;width:" + diameter + "px;height:" + diameter + "px;");
        if( locations[box.name] ) boxElement.classList.add("box-taken");
        else boxElement.classList.remove("box-taken");
        boxElement.onclick = (function(box, boxElement) {
            return function(e) {
                if( !boxElement.querySelector(".popout") ) createPopout(box, boxElement);
                e.stopPropagation();
            }
        })(box, boxElement);
        map.appendChild(boxElement);
    }
}

/**
 * Create a popout.
 * @param {Object} box - The box object.
 * @param {HTMLElement} boxElement - The box element.
 */
function createPopout(box, boxElement) {
    document.body.click(); // get rid of the previous popup
    var popout = document.createElement("div");
    popout.classList.add("popout");
    popout.innerText = box.name;
    if( locations[box.name] ) popout.innerHTML += "<br>" + locations[box.name];
    popout.innerHTML += "<br>";
    var punch = document.createElement("button");
    punch.innerText = "Punch";
    punch.onclick = function() {
        var name = document.querySelector("#name").value;
        if( !name ) {
            createToast("Please enter a name");
        }
        else {
            makeRequest("POST", "/check", {
                name: name,
                location: box.name
            }, function(text) {
                createToast("Punch Successful");
            }, function(text) {
                try {
                    var json = JSON.parse(text);
                    if( json.message ) createToast(json.message);
                    else createToast(GENERIC_ERROR)
                }
                catch(err) {
                    createToast(GENERIC_ERROR);
                }
            })
        }
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