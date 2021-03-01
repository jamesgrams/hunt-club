var STATUS_FETCH_INTERVAL = 1000;
var GENERIC_ERROR = "An error has occurred";
var ID_COOKIE = "hunt-club-id";
var TOKEN_COOKIE = "hunt-club-token";

var circleDiameterPercent;
var statusTimeout;
var statusFetchCount = 0;
var mapId;
var chat = [];
var locations = {};
var currentDrawStatus = {};
var nextDrawStatus = {};
var passes = {};
var imageJustLoaded = false;

window.addEventListener('load', function() {

    loadMap();
    setupLogin();
    setupDrawing();
    setupPhysical();
    setupChat();

});

/**
 * Setup the admin.
 * This isn't called on every load.
 * @param {number} selectedId - The user ID to start as selected.
 */
function setupAdmin( selectedId ) {
    makeRequest("GET", "/user", {}, function(responseText) {
        var users = JSON.parse(responseText).users;
        var select = document.querySelector("#admin-select");
        select.innerText = "";
        users.unshift({
            id: "",
            name: "",
            email: "",
            phone: ""
        });
        for( var i=0; i<users.length; i++ ) {
            var option = document.createElement("option");
            option.innerText = users[i].name;
            option.setAttribute("data-email", users[i].email);
            option.setAttribute("data-phone", users[i].phone);
            option.setAttribute("value", users[i].id);
            if( users[i].id == selectedId ) option.setAttribute("selected","selected");
            select.appendChild(option);
        }
        var adminEmail = document.querySelector("#admin-email");
        var adminPhone = document.querySelector("#admin-phone");
        var adminName = document.querySelector("#admin-name");
        var adminPassword = document.querySelector("#admin-password");
        select.onchange = function() {
            var selectedElement = select.options[select.selectedIndex];
            var email = selectedElement.getAttribute("data-email");
            var phone = selectedElement.getAttribute("data-phone");
            var id = selectedElement.getAttribute("value");
            var name = selectedElement.innerText;
            if( !id ) {
                adminEmail.value = "";
                adminPhone.value = "";
                adminName.value = "";
                adminPassword.value = "";
                document.querySelector("#update-user").classList.add("hidden");
                document.querySelector("#delete-user").classList.add("hidden");
                document.querySelector("#priority-user").classList.add("hidden");
                document.querySelector("#add-user").classList.remove("hidden");
            }
            else {
                adminEmail.value = email;
                adminPhone.value = phone;
                adminName.value = name;
                adminPassword.value = "";
                document.querySelector("#add-user").classList.add("hidden");
                document.querySelector("#update-user").classList.remove("hidden");
                document.querySelector("#delete-user").classList.remove("hidden");
                document.querySelector("#priority-user").classList.remove("hidden");
            }
        }
        select.onchange();
        document.querySelector("#add-user").onclick = function(e) {
            e.preventDefault();
            makeRequest("POST", "/user", { 
                email: adminEmail.value,
                phone: adminPhone.value,
                name: adminName.value,
                password: adminPassword.value
            }, function() {
                setupAdmin();
                createToast("User added");
            }, errorToast);
        }
        document.querySelector("#update-user").onclick = function(e) {
            e.preventDefault();
            makeRequest("PUT", "/user", {
                id: select.value,
                email: adminEmail.value,
                phone: adminPhone.value,
                name: adminName.value,
                password: adminPassword.value
            }, function() {
                setupAdmin( select.value );
                createToast("User updated");
            }, errorToast);
        }
        document.querySelector("#delete-user").onclick = function(e) {
            e.preventDefault();
            if( !window.confirm("Are you sure you want to delete this user?") ) return;
            makeRequest("DELETE", "/user", {
                id: select.value
            }, function() {
                setupAdmin();
                createToast("User deleted");
            }, errorToast);
        }
        document.querySelector("#priority-user").onclick = function(e) {
            e.preventDefault();
            makeRequest("POST", "/pass", {
                id: select.value
            }, function() {
                createToast("Priority pass granted");
            }, errorToast);
        }
        document.querySelector("#admin").classList.remove("hidden-for-page");
    }, errorToast);
}

/**
 * Setup the chat.
 */
function setupChat() {
    document.querySelector("#submit-chat").onclick = function(e) {
        e.preventDefault();
        var chatMessage = document.querySelector("#chat-message");
        if( !chatMessage.value ) return;
        makeRequest("POST", "/chat", {
            message: chatMessage.value
        }, function() {}, errorToast);
        chatMessage.value = "";
    }
}

/**
 * Setup the physical check in.
 */
function setupPhysical() {
    document.querySelector("#physical").onclick = function() {
        if( !navigator.geolocation ) createToast("Your device doesn't support geolocation");
        else {
            navigator.geolocation.getCurrentPosition( function(position) {
                makeRequest("POST", "/physical", { lat: position.coords.latitude, lng: position.coords.longitude }, 
                function(responseText) {
                    createToast( JSON.parse(responseText).message );
                }, errorToast);
            }, function() {
                createToast("Could not fetch location");
            }, {
                enableHighAccuracy: true
            });
        }
    }
}

/**
 * Setup the drawing section.
 */
function setupDrawing() {
    document.querySelectorAll("#enter-next, #exit-next").forEach( function(el) {
        el.onclick = function() {
            makeRequest("POST", "/drawing", {}, function(text) {
                createToast( el.getAttribute("id") === "enter-next" ? "Drawing entered" : "Drawing exited" );
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

    document.querySelectorAll("#pass-next, #no-pass-next").forEach( function(el) {
        el.onclick = function() {
            makeRequest("POST", "/priority", {}, function(text) {
                createToast( el.getAttribute("id") === "pass-next" ? "Priority Pass set to be used" : "Priority Pass set to not be used" );
                fetchStatus();
            }, errorToast);
        }
    });
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
        chat = [];
        locations = {};
        currentDrawStatus = {};
        nextDrawStatus = {};
        passes = {};
        document.querySelector("#logout-section").classList.add("hidden");
        document.querySelector("#chat").classList.add("hidden");
        document.querySelector("#admin").classList.add("hidden");
        document.querySelector("#login-section").classList.remove("hidden");
        document.querySelector("#user-name").innerText = "";
        document.querySelector("#chat-messages").innerText = "";
        document.querySelector("#admin-select").innerText = "";
        document.querySelector("#admin-current-user").innerText = "";
        document.querySelector("#admin-email").value = "";
        document.querySelector("#admin-password").value = "";
        document.querySelector("#admin-name").value = "";
        document.querySelector("#admin-phone").value = "";
        document.querySelectorAll(".box").forEach( function(el) {
            el.parentElement.removeChild(el);
        });
    }
    else {
        document.querySelector("#login-section").classList.add("hidden");
        document.querySelector("#logout-section").classList.remove("hidden");
        document.querySelector("#chat").classList.remove("hidden");
        var info = JSON.parse(decodeURIComponent(idCookie));
        if( info.admin ) {
            document.querySelector("#admin").classList.remove("hidden");
        }
        document.querySelector("#user-name").innerText = info.name;
        if( mapId === "admin" ) setupAdmin(); // doesn't update in fetchStatus so need to call here
    }

    document.querySelector("#login").onclick = function(e) {
        e.preventDefault();
        var email = document.querySelector("#email");
        var password = document.querySelector("#password");
        var emailValue = email.value;
        var passwordValue = password.value;
        password.value = "";
        makeRequest("POST", "/login", {
            email: emailValue,
            password: passwordValue
        }, function(text) {
            email.value = "";
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
    if( mapId === "chat" ) {
        document.querySelector("#chat").classList.remove("hidden-for-page");
        var mapName = "Chat";
        document.title = mapName + ": " + document.title;
        var h1 = document.querySelector("h1");
        h1.innerText = mapName + ": " + h1.innerText;
        fetchStatus(); // may be a good idea to split chat status and map status... maybe
        return;
    }
    if( mapId === "admin" ) {
        var mapName = "Admin";
        document.title = mapName + ": " + document.title;
        var h1 = document.querySelector("h1");
        h1.innerText = mapName + ": " + h1.innerText; // NO FETCH STATUS FOR THIS PAGE (not true because we need drawing)
        setupAdmin();
        fetchStatus(); // need to fetch status for drawing actually.
        return;
    }
    makeRequest("GET", "/map", { mapId: mapId }, function(text) {
        var json = JSON.parse(text);
        circleDiameterPercent = json.map.circle_diameter;
        var img = document.createElement("img");
        img.setAttribute("src", json.map.image_src);
        img.setAttribute("alt", json.map.name + " Map");
        img.onload = function() {
            imageJustLoaded = true;
        }
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
        var prevChat = chat;
        chat = json.chat;
        var prevPasses = passes;
        passes = json.passes;
        statusTimeout = setTimeout(fetchStatus, STATUS_FETCH_INTERVAL);
        window.onresize = addBoxes;
        if( imageJustLoaded || JSON.stringify(locations) !== JSON.stringify(prevLocations) || (!document.querySelector(".box") && Object.keys(locations).length) ) {
            addBoxes(); // redraw
            imageJustLoaded = false;
        }
        if( JSON.stringify(passes) !== JSON.stringify(prevPasses) || JSON.stringify(prevCurrentDrawStatus) !== JSON.stringify(currentDrawStatus) || JSON.stringify(prevNextDrawStatus) !== JSON.stringify(nextDrawStatus) ) {
            addDraws();
        }
        if( JSON.stringify(chat) !== JSON.stringify(prevChat) ) {
            addChat();
        }
    }, function(err) {
        if(statusFetchCount !== myCallStatusFetchCount) return;
        console.log(err);
        statusTimeout = setTimeout(fetchStatus, STATUS_FETCH_INTERVAL);
    });
}

/**
 * Add chat information.
 */
function addChat() {
    var chatMessages = document.querySelector("#chat-messages");
    var prevScrollTop = chatMessages.scrollTop;
    var atBottom = chatMessages.scrollTop === chatMessages.scrollHeight - chatMessages.clientHeight;
    var newChatMessages = document.createElement("div");
    newChatMessages.setAttribute("id", "chat-messages");
    for( var i=0; i<chat.length; i++ ) {
        var messageElement = document.createElement("div");
        messageElement.classList.add("message");

        var usernameElement = document.createElement("div");
        usernameElement.classList.add("message-user");
        usernameElement.innerText = chat[i].user;
        messageElement.appendChild(usernameElement);

        var contentElement = document.createElement("div");
        contentElement.classList.add("message-content");
        contentElement.innerText = chat[i].content; // innerText is important for XSS
        messageElement.appendChild(contentElement);

        var timeElement = document.createElement("div");
        timeElement.classList.add("message-time");
        timeElement.innerText = chat[i].created;
        messageElement.appendChild(timeElement);

        newChatMessages.appendChild(messageElement);
    }
    chatMessages.replaceWith(newChatMessages);
    newChatMessages.scrollTo(0, atBottom ? newChatMessages.scrollHeight : prevScrollTop );
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
    var passSection = document.querySelector("#pass-section");
    if( nextDrawStatus.inNextDraw ) {
        enterNext.classList.add("hidden");
        exitNext.classList.remove("hidden");
        passSection.classList.remove("hidden");
    }
    else {
        passSection.classList.add("hidden");
        exitNext.classList.add("hidden");
        enterNext.classList.remove("hidden");
    }

    var passNext = document.querySelector("#pass-next");
    var noPassNext = document.querySelector("#no-pass-next");
    if( !passes.availablePasses.length && !passes.toBeUsedPasses.length ) {
        passNext.classList.add("hidden");
        noPassNext.classList.add("hidden");
    }
    else {
        if( passes.toBeUsedPasses.length ) {
            passNext.classList.add("hidden");
            noPassNext.classList.remove("hidden");
        }
        else {
            noPassNext.classList.add("hidden");
            passNext.classList.remove("hidden");
        }
    }
    document.querySelector("#pass-count").innerText = passes.availablePasses.length;
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
        if( location.user.physical ) boxElement.classList.add("box-physical");
        else boxElement.classList.remove("box-physical");
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
        if( location.user.guest ) popoutName.innerText += " & " + location.user.guest;
        popout.appendChild(popoutName);
        var popoutPhone = document.createElement("div");
        popoutPhone.classList.add("popout-phone");
        popoutPhone.innerText = location.user.phone;
        popout.appendChild(popoutPhone);
        var popoutDate = document.createElement("div");
        popoutDate.classList.add("popout-created");
        popoutDate.innerText = location.user.created;
        popout.appendChild(popoutDate);
    }
    
    var punch = document.createElement("button");
    punch.innerText = "Punch";
    punch.onclick = function() {
        makeRequest("POST", "/check", {
            locationId: location.location.id,
            guest: document.querySelector("#guest").value
        }, function(text) {
            createToast("Punch Successful");
            fetchStatus(); // only fetch if we aren't already
        }, errorToast);
    }
    popout.appendChild(punch);

    var history = document.createElement("button");
    history.innerText = "History";
    history.onclick = function() {
        makeRequest("GET", "/history", {
            locationId: location.location.id
        }, function(text) {

            var json = JSON.parse(text);
            var content = document.createElement("div");
            content.classList.add("history");
            var title = document.createElement("div");
            title.classList.add("history-title");
            title.innerText = "History for " + location.location.name;
            content.appendChild(title);

            var currentDate = null;
            function addContent() {
                var contentButton = content.querySelector("button");
                if( !json.history.huntings.length ) {
                    if( contentButton ) contentButton.parentElement.removeChild(contentButton);
                    return;
                }

                for( var i=0; i<json.history.huntings.length; i++ ) {
                    var current = json.history.huntings[i];

                    if( current.date != currentDate ) {
                        var date = document.createElement("div");
                        date.classList.add("history-date");
                        date.innerText = current.date
                        content.appendChild(date);
                        currentDate = current.date;
                    }

                    var line = document.createElement("div");
                    line.classList.add("history-line");
                    var name = document.createElement("div");
                    name.classList.add("history-name");
                    name.innerText = current.user.name;
                    line.appendChild(name);
                    var times = document.createElement("div");
                    times.classList.add("history-time");
                    times.innerText = current.time.join(" - ");
                    line.appendChild(times);

                    content.appendChild(line);

                }
                if( contentButton ) {
                    content.appendChild(contentButton);
                }
            }
            addContent( json );
            var loadMore = document.createElement("button");
            loadMore.innerText = "Load More";
            loadMore.onclick = function() {
                makeRequest("GET", "/history", {
                    locationId: location.location.id,
                    from: json.history.next
                }, function(text) {
                    json = JSON.parse(text);
                    addContent();
                }, errorToast);
            }
            content.appendChild(loadMore);
            createModal( content );
        }, errorToast);
    }
    popout.appendChild(history);

    boxElement.appendChild(popout);
    document.body.onclick = function() {
        try {
            popout.parentElement.removeChild(popout);
        }
        catch(err) {}
    }
}

/**
 * Create a modal.
 * @param {HTMLElement} content - The content for the modal.
 */
function createModal( content ) {
    closeModal();
    var blocker = document.createElement("div");
    blocker.classList.add("blocker");
    blocker.onclick = function(e) {
        e.stopPropagation();
        closeModal();
    }
    var modal = document.createElement("div");
    modal.classList.add("modal");
    modal.onclick = function(e) {
        e.stopPropagation();
    }
    modal.appendChild(content);
    document.body.appendChild(blocker);
    document.body.appendChild(modal);
}

/**
 * Close a current modal if it exists.
 */
function closeModal() {
    var modal = document.querySelector(".modal");
    if( modal ) {
        modal.parentElement.removeChild(modal);
        var blocker = document.querySelector(".blocker");
        if( blocker ) blocker.parentElement.removeChild(blocker);
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