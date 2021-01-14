const express = require('express');
const mysql = require('mysql2/promise');
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const cookieParser = require("cookie-parser");
const minimist = require("minimist");
require('dotenv').config();

const PORT = process.env.PORT || 80;
const JSON_ENCODING = "application/json";
const MAX_FETCH_COUNT = 3;
const SUCCESS = "success";
const FAILURE = "failure";
const HTTP_OK = 200;
const HTTP_BAD = 500;
const HTTP_UNAUTHORIZED = 401;

const CRYPTO_KEY_LEN = 128;
const SALT_RANDOM_LEN = 20;
// Token expires in
const TOKEN_OPTIONS = {"expiresIn": "90d"};
const TOKEN_EXPIRES_IN_MS = 1000 * 60 * 60 * 24 * 90;
const TOKEN_KEY = process.env.TOKEN_KEY;
// Token cookie
const TOKEN_COOKIE = "hunt-club-token";
const ID_COOKIE = "hunt-club-id";
const TIME_TO_PICK = 1000 * 30; // 30 seconds

const ERROR_MESSAGES = {
    someoneElsePunchedIn: "Someone else is already at that location",
    signedInSomewhereElse: "You are signed in somewhere else",
    pleaseProvideAnEmailAndPassword: "Please provide an email and password",
    accountDoesNotExist: "Account does not exist",
    invalidToken: "Invalid session - please log in again",
    noToken: "Please log in first",
    noMapSpecified: "No map specified",
    noLocationOrUser: "A location or user is missing",
    mapNotFound: "Map not found",
    notYourTurn: "It's not your turn to draw",
    drawProcessing: "The current draw order is being determined, please wait a little bit"
}

let connection;
let drawEntrants = [];
let drawIndex = null; // entrant currently on
let drawTimeout;
let drawHappening = false;
let drawLock = false;

// Setup app
const app = express();
app.use( express.json() );
app.use( cookieParser() );

// Endpoints
app.use("/assets/", express.static("assets"));

// Get the current status for a map
app.get("/status", async function(request, response) {
    let token = request.cookies[TOKEN_COOKIE];
    let obj = {};
    let code = HTTP_OK;
    try {
        let user = await validateToken(token);
        try {
            let locations = await status( request.query.mapId );
            let currentDrawStatus = await currentDrawingStatus( user.id );
            let nextDrawStatus = await nextDrawingStatus( user.id );
            obj = { 
                locations: locations,
                currentDrawStatus: currentDrawStatus,
                nextDrawStatus: nextDrawStatus,
                status: SUCCESS
            };
        }
        catch(err) {
            code = HTTP_BAD;
            if(err.message) console.log(err);
            obj = {
                status: FAILURE,
                message: err.message || err
            }
        }
    }
    catch(err) {
        code = HTTP_UNAUTHORIZED;
        if(err.message) console.log(err);
        obj = {
            status: FAILURE,
            message: err.message || err
        }
    }
    response.set({ 'content-type':  JSON_ENCODING });
    response.writeHead(code);
    response.end( JSON.stringify(obj) );
});

// Check in
// Node is single-threaded so requests will be run in the order they are sent
app.post("/check", async function(request, response) {
    let token = request.cookies[TOKEN_COOKIE];
    let code = HTTP_OK;
    let obj = {};
    try {
        let user = await validateToken(token);
        try {
            await check( request.body.locationId, user.id );
            obj = Object.assign( obj, {
                status: SUCCESS
            });
        }
        catch(err) {
            code = HTTP_BAD;
            if(err.message) console.log(err);
            obj = {
                status: FAILURE,
                message: err.message || err
            }
        }
    }
    catch(err) {
        code = HTTP_UNAUTHORIZED;
        if(err.message) console.log(err);
        obj = {
            status: FAILURE,
            message: err.message || err
        }
    }

    
    response.set({ 'content-type':  JSON_ENCODING });
    response.writeHead(code);
    response.end( JSON.stringify(obj) );
});

// Log in
app.post("/login", async function(request, response) {
    let code = HTTP_OK;
    let obj;
    try {
        let loginInfo = await createToken( request.body.email, request.body.password );
        response.cookie( TOKEN_COOKIE, loginInfo.token, { maxAge: TOKEN_EXPIRES_IN_MS } );
        response.cookie( ID_COOKIE, JSON.stringify(loginInfo.id), { maxAge: TOKEN_EXPIRES_IN_MS} );
        obj = {
            status: SUCCESS,
            loginInfo: loginInfo
        }
    }
    catch(err) {
        code = HTTP_BAD;
        if(err.message) console.log(err);
        obj = {
            status: FAILURE,
            message: err.message || err
        }
    }
    response.set({ 'content-type':  JSON_ENCODING });
    response.writeHead(code);
    response.end( JSON.stringify(obj) );
} );

// Get info about a map
app.get("/map",  async function(request, response) {
    let obj = {};
    let code = HTTP_OK;
    try {
        obj = await mapInfo( request.query.mapId );
        obj = { 
            map : obj,
            status: SUCCESS
        };
    }
    catch(err) {
        code = HTTP_BAD;
        if(err.message) console.log(err);
        obj = {
            status: FAILURE,
            message: err.message || err
        }
    }
    response.set({ 'content-type':  JSON_ENCODING });
    response.writeHead(code);
    response.end( JSON.stringify(obj) );
});

// Drawing
app.post("/drawing", async function(request, response) {
    let token = request.cookies[TOKEN_COOKIE];
    let code = HTTP_OK;
    let obj = {};
    try {
        let user = await validateToken(token);
        try {
            await toggleDrawing( user.id );
            obj = Object.assign( obj, {
                status: SUCCESS
            });
        }
        catch(err) {
            code = HTTP_BAD;
            if(err.message) console.log(err);
            obj = {
                status: FAILURE,
                message: err.message || err
            }
        }
    }
    catch(err) {
        code = HTTP_UNAUTHORIZED;
        if(err.message) console.log(err);
        obj = {
            status: FAILURE,
            message: err.message || err
        }
    }

    response.set({ 'content-type':  JSON_ENCODING });
    response.writeHead(code);
    response.end( JSON.stringify(obj) );
});

main();

// Functions
async function main() {
    connection = await mysql.createConnection({
        host: process.env.MYSQL_HOST,
        user: process.env.MYSQL_USER,
        password: process.env.MYSQL_PASSWORD,
        database: process.env.MYSQL_DATABASE,
        port: process.env.MYSQL_PORT
    });

    // script can be used to add a user with --email <email> --password <password> --name <name> --phone <phone>
    // dotenv helps with .env file - does what heroku does
    let args = minimist(process.argv.slice(2));
    if( args.email && args.password && args.name && args.phone ) {
        const crypto = require("crypto");

        let salt = crypto.randomBytes(20).toString('hex');

        let hash = crypto.scryptSync(args.password, salt, CRYPTO_KEY_LEN).toString("hex");

        await connection.execute("INSERT INTO users(email,hash,salt,name,phone) VALUES(?,?,?,?,?)", [args.email,hash,salt,args.name,args.phone]);
        console.log("Inserted");
        return;
    }

    app.listen(PORT);
    startDrawAtRightTime();
}

/**
 * Check in or check out from a location.
 * @param {number} locationId - The id of the location.
 * @param {number} userId - The id of the person punching.
 * @param {boolean} force - Force check out even during a draw.
 * @returns {Promise} - A resolved promise.
 */
async function check(locationId, userId, force) {
    if( !locationId || !userId ) return Promise.reject(ERROR_MESSAGES.noLocationOrUser );
    let [rows, fields] = await connection.execute("SELECT count(1) AS count FROM checks WHERE user_id != ? AND location_id = ? ORDER BY created DESC", [userId, locationId]);
    // Make sure some one else isn't punched in
    if( rows[0].count % 2 === 1 ) {
        return Promise.reject(ERROR_MESSAGES.someoneElsePunchedIn);
    }
    // Make sure we're not punched in anywhere else
    [rows, fields] = await connection.execute("SELECT location_id, count(1) AS count FROM checks WHERE user_id = ? AND location_id != ? GROUP BY location_id HAVING MOD(count, 2) = 1", [userId, locationId]);
    if( rows.length ) return Promise.reject(ERROR_MESSAGES.signedInSomewhereElse);

    // Drawing check
    if( !force && drawHappening ) {
        let status = await currentDrawingStatus( userId );
        if( status.drawOrder === null || status.drawOrder !== drawIndex ) {
            return Promise.reject(ERROR_MESSAGES.notYourTurn);
        }
    }

    await connection.execute("INSERT INTO checks(location_id,user_id) VALUES (?,?)", [locationId,userId]);
    if( !force && drawHappening ) advancePick();
    return Promise.resolve();
}

/**
 * Check the current status of the magnet board.
 * @param {number} mapId - The ID of the map.
 * @returns {Promise<Object>} - A resolved promise containing an object with locations as keys and people as values.
 */
async function status( mapId ) {
    if( !mapId ) return Promise.reject(ERROR_MESSAGES.noMapSpecified);
    // counts on id being in order of when created
    let [rows, fields] = await connection.execute("SELECT users.id as user_id, locations.id as location_id, users.name as user_name, users.phone as user_phone, locations.name as location, x, y FROM (SELECT max(id) as id, count(1) as count FROM checks group by location_id having MOD(count, 2) = 1) AS ids JOIN checks on checks.id = ids.id JOIN users ON checks.user_id = users.id RIGHT OUTER JOIN locations ON checks.location_id = locations.id WHERE locations.map_id = ?", [mapId]);
    let locations = {};
    for( let row of rows ) {
        locations[row.location_id] = {
            user: {
                id: row.user_id,
                name: row.user_name,
                phone: row.user_phone
            },
            location: {
                id: row.location_id,
                name: row.location,
                x: row.x,
                y: row.y
            }
        };
    }
    return Promise.resolve(locations);
}

/**
 * Get information about a map
 * @param {number} mapId - The ID of the map.
 * @returns {Promise<}
 */
async function mapInfo( mapId ) {
    if( !mapId ) return Promise.reject(ERROR_MESSAGES.noMapSpecified);
    let [rows, fields] = await connection.execute("SELECT name, image_src, circle_diameter FROM maps WHERE id = ?", [mapId]);
    if( !rows.length ) return Promise.reject(ERROR_MESSAGES.mapNotFound);
    return Promise.resolve(rows[0]);
}

/**
 * Enter the drawing for the next day or leave it if already in it.
 * @param {number} userId - The ID of the user.
 */
async function toggleDrawing( userId ) {
    if( drawLock ) return Promise.reject(ERROR_MESSAGES.drawProcessing);
    let status = await nextDrawingStatus( userId );
    if( status.inNextDraw ) {
        await connection.execute("DELETE FROM drawings WHERE user_id = ? AND draw_order is null", [userId]);
    }
    else {
        await connection.execute("INSERT INTO drawings(user_id) VALUES (?)", [userId]);
    }
    return Promise.resolve();
}

/**
 * Get the drawing status for the next drawing.
 * @param {number} userId - The ID of the user.
 * @returns {Promise<Object>} - A promise containing an object with keys for in draw. 
 */
async function nextDrawingStatus( userId ) {
    // The last drawing will get modified once draw_order is added, so select those without a draw_order.
    let [rows, fields] = await connection.execute("SELECT 1 FROM drawings WHERE user_id = ? AND draw_order is null", [userId]);
    let inNextDraw = false;
    if( rows.length ) {
        inNextDraw = true;
    }
    return Promise.resolve( {
        inNextDraw: inNextDraw
    } );
}

/**
 * Get the status for the current drawing.
 * @param {number} userId - The ID of the user.
 * @returns {Object} - An object with details about the current drawing.
 */
function currentDrawingStatus( userId ) {
    let drawOrder = null;
    // Get the draw order
    if( drawHappening ) {
        let i = 0;
        for( let entrant of drawEntrants ) {
            if( entrant.user_id === userId ) {
                drawOrder = i;
                break;
            }
            i++;
        }
    }
    let tmpTimeout = setTimeout(() => {}, 0); // this will get us the current time from a starting point that node stores it for timeouts
    return {
        drawOrder: drawOrder, // order in the draw
        drawHappening: drawHappening, // boolean
        drawOn: drawIndex, // who the draw is on
        drawSecondsLeft: drawTimeout ? Math.ceil((drawTimeout._idleStart + drawTimeout._idleTimeout - tmpTimeout._idleStart) / 1000) : null
    };
}

/**
 * Start performing a drawing.
 */
async function performDrawing() {
    drawHappening = true;
    drawLock = true;
    let [rows, fields] = await connection.execute("SELECT id FROM maps");
    // Make sure everybody is checked out
    for( let row of rows ) {
        let locations = await status( row.id );
        for( let locationId in locations ) {
            if( locations[locationId].user.id ) {
                check( locationId, locations[locationId].user.id, true ); // check the user out
            }
        }
    }
    [rows, fields] = await connection.execute("SELECT id, user_id FROM drawings WHERE draw_order is null");
    drawEntrants = shuffle(rows);
    for( let i=0; i<drawEntrants.length; i++ ) {
        await connection.execute("UPDATE drawings SET draw_order = ? WHERE id = ?", [i, drawEntrants[i].id]); // this will be for records and to mark draw enterings as complete, but the draw will take place using the in memory drawingEntrants array
    }
    drawLock = false; // Prevent entering the draw for a short period of time, so we don't for example, try to go to update all the entrants and not have one there as it was deleted
    advancePick();
}

/**
 * Advance pick in the draw
 */
function advancePick() {
    clearTimeout( drawTimeout );
    if( drawIndex === null ) drawIndex = 0;
    else drawIndex ++;

    // end of draw
    if( drawIndex === drawEntrants.length ) {
        drawEntrants = [];
        drawIndex = null;
        drawTimeout = null;
        drawHappening = false;
    }
    else {
        drawTimeout = setTimeout(advancePick, TIME_TO_PICK);
    }
}

/**
 * Create an access token.
 * @param {string} email - The email of the user.
 * @param {string} password - The password of the user.
 * @returns {Promise<Object>} - The token and id object if the login is successful or an error message if not.
 */
async function createToken( email, password ) {
    if( !email || !password ) {
        return Promise.reject(ERROR_MESSAGES.pleaseProvideAnEmailAndPassword);
    }

    let [rows, fields] = await connection.execute("SELECT id, email, hash, salt, name, phone FROM users WHERE email = ?", [email]);
    if( !rows.length ) return Promise.reject(ERROR_MESSAGES.accountDoesNotExist);
    let user = rows[0];
    
    if(user.hash) {
        if( crypto.scryptSync(password, user.salt, CRYPTO_KEY_LEN).toString("hex") == user.hash ) {
            let id = {"id": user.id, "email": user.email };
            let token = jwt.sign( id, TOKEN_KEY, TOKEN_OPTIONS );
            id.name = user.name;
            id.phone = user.phone;
            return Promise.resolve({
                token: token,
                id: id    
            });
        }
        else {
            return Promise.reject(ERROR_MESSAGES.accountDoesNotExist);
        }
    }
    else {
        return Promise.reject(ERROR_MESSAGES.accountDoesNotExist);
    }
}

/**
 * Validate the header token.
 * @param {string} token - The user token.
 * @returns {Promise<Object>} - A promise containing the decrypted object or a rejected promise with an error message.
 */
async function validateToken( token ) {
    if( token ) {
        try {
            let result = jwt.verify( token, TOKEN_KEY, TOKEN_OPTIONS );
            return Promise.resolve(result);
        }
        catch(err) {
            console.log(err);
            return Promise.reject(ERROR_MESSAGES.invalidToken);
        }
    }
    else {
        return Promise.reject(ERROR_MESSAGES.noToken);
    }
}

/**
 * Shuffle an array.
 * @param {Array} array - The array to shuffle.
 * @returns {Array} The shuffled array. 
 */
function shuffle(array) {
    var currentIndex = array.length, temporaryValue, randomIndex;
  
    // While there remain elements to shuffle...
    while (0 !== currentIndex) {
  
      // Pick a remaining element...
      randomIndex = Math.floor(Math.random() * currentIndex);
      currentIndex -= 1;
  
      // And swap it with the current element.
      temporaryValue = array[currentIndex];
      array[currentIndex] = array[randomIndex];
      array[randomIndex] = temporaryValue;
    }
  
    return array;
}

/**
 * Start draw at 5AM every day
 */
function startDrawAtRightTime() {
    let now = new Date();
    // send at 5am
    // be sure TZ is set properly in heroku's environment variables - we are on eastern time, so that's when our sign up is
    let millisTilSend = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 5, 0, 0, 0) - now;
    if (millisTilSend < 0) {
        millisTilSend += 86400000; // it's after 5am, try 5am tomorrow.
    }
    setTimeout( () => {
        console.log("starting draw");
        performDrawing();
        setTimeout( startDrawAtRightTime, 1000 ); // wait a second just to be safe that we don't double send.
    }, millisTilSend);
}