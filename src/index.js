const express = require('express');
const mysql = require('mysql2/promise');
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const cookieParser = require("cookie-parser");
const minimist = require("minimist");
const nodemailer = require("nodemailer");
require('dotenv').config();

const PORT = process.env.PORT || 80;
const JSON_ENCODING = "application/json";
const MAX_FETCH_COUNT = 3;
const SUCCESS = "success";
const FAILURE = "failure";
const HTTP_OK = 200;
const HTTP_BAD = 422;
const HTTP_UNAUTHORIZED = 401;
const HTTP_REDIRECT = 301;
// be sure to set the TZ environment variable as well

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
const HOG_SEASON_END = 1; // feb - end and start are both inclusive
const TURKEY_SEASON_START = 2;
const TURKEY_SEASON_END = 4;
const OFF_SEASON_START = 5;
const OFF_SEASON_END = 7;
const DEER_SEASON_START = 8;
const MAX_SIGNINS_DURING_DEER_SEASON = 2;

const ERROR_MESSAGES = {
    someoneElsePunchedIn: "Someone else is already at that location",
    signedInSomewhereElse: "You are signed in to the maximun number of locations",
    pleaseProvideAnEmailAndPassword: "Please provide an email and password",
    accountDoesNotExist: "Account does not exist",
    invalidToken: "Invalid session - please log in again",
    noToken: "Please log in first",
    noMapSpecified: "No map specified",
    noLocationOrUser: "A location or user is missing",
    mapNotFound: "Map not found",
    notYourTurn: "It's not your turn to draw",
    drawProcessing: "The current draw order is being determined, please wait a little bit",
    notBordering: "Please ensure you choose neighboring sites",
    chainBroken: "Please ensure all your sites will remain neighbors",
    drawNotHappening: "No draw is currently happening",
    deerSeasonMaxSignIns: "You can only sign in twice per day during Deer Season",
    notWithinAnyMap: "You aren't located within any map",
    noChatMessage: "Please enter a message",
    noUserSpecified: "No user specified",
    cannotDeleteSelf: "You can't delete yourself",
    missingUserFields: "Please fill out all fields"
}

let connection;
let drawEntrants = [];
let drawIndex = null; // entrant currently on
let drawTimeout;
let drawHappening = false;
let drawLock = false; // use drawing for methods and draw for variables typically
let drawChecksForUser = 0;
let maxPlaces = 0;
// Rule 7 - Deer Season vs. Turkey Season vs. Small Game Season = https://7e84de4f-1182-4832-a9d7-e247c41177b7.filesusr.com/ugd/b992ec_79544ec907c041d7af890d5eb5702431.pdf
let month = new Date().getMonth();
if( month <= HOG_SEASON_END ) maxPlaces = 4; // Jan and Feb
else if( month >= TURKEY_SEASON_START && month <= TURKEY_SEASON_END ) maxPlaces = 2; // March - May
if( month >= OFF_SEASON_START && month <= OFF_SEASON_END ) maxPlaces = 4; // June - August
else if( month >= DEER_SEASON_START ) maxPlaces = 1; // September+

// Setup app
const app = express();
app.use( express.json() );
app.use( cookieParser() );
// Redirect the app
app.use((req,res,next) => {
    // HTTPs
    if (!req.secure && req.get('x-forwarded-proto') !== 'https' && process.env.NODE_ENV !== "development") {
        return res.redirect(HTTP_REDIRECT, 'https://' + req.get('host') + req.url);
    }
    next();
});

// Endpoints
app.use("/assets/", express.static("assets"));

// Get the current status for a map and draw
app.get("/status", async function(request, response) {
    await action( request, response, true, async ( request, user ) => {
        let locations = await status( request.query.mapId );
        let currentDrawStatus = await currentDrawingStatus( user.id );
        let nextDrawStatus = await nextDrawingStatus( user.id );
        let chat = await getChat();
        return Promise.resolve({ 
            locations: locations,
            currentDrawStatus: currentDrawStatus,
            nextDrawStatus: nextDrawStatus,
            chat: chat,
            status: SUCCESS
        });
    });
});

// Check in
// Node is single-threaded so requests will be run in the order they are sent
app.post("/check", async function(request, response) {
    await action( request, response, true, async ( request, user ) => {
        await check( request.body.locationId, user.id, false, request.body.guest );
        return Promise.resolve({
            status: SUCCESS
        });
    });
});

// Log in
app.post("/login", async function(request, response) {
    await action( request, response, false, async ( request, user ) => {
        let loginInfo = await createToken( request.body.email, request.body.password );
        response.cookie( TOKEN_COOKIE, loginInfo.token, { maxAge: TOKEN_EXPIRES_IN_MS } );
        response.cookie( ID_COOKIE, JSON.stringify(loginInfo.id), { maxAge: TOKEN_EXPIRES_IN_MS} );
        return Promise.resolve({
            status: SUCCESS,
            loginInfo: loginInfo
        });
    } );
} );

// Get info about a map
app.get("/map",  async function(request, response) {
    await action( request, response, false, async ( request, user ) => {
        obj = await mapInfo( request.query.mapId );
        return Promise.resolve({ 
            map : obj,
            status: SUCCESS
        });
    } );
});

// Drawing
app.post("/drawing", async function(request, response) {
    await action( request, response, true, async ( request, user ) => {
        await toggleDrawing( user.id );
        return Promise.resolve({
            status: SUCCESS
        });
    } );
});

// Skip
app.post("/skip", async function(request, response) {
    await action( request, response, true, async ( request, user ) => {
        await skip( user.id );
        return Promise.resolve({
            status: SUCCESS
        });
    } );
});

// Check in to a physical location
app.post("/physical", async function(request, response) {
    await action( request, response, true, async ( request, user ) => {
        let message = await physical( request.body.lat, request.body.lng, user.id );
        return Promise.resolve({
            status: SUCCESS,
            message: message
        })
    } );
});

// Add a chat message
app.post("/chat", async function(request, response) {
    await action( request, response, true, async ( request, user ) => {
        await postChat( user.id, request.body.message );
        return Promise.resolve({
            status: SUCCESS
        })
    } );
});

// Add a user
app.post("/user", async function(request, response) {
    await action( request, response, true, async ( request, user ) => {
        await addUser( request.body.email, request.body.password, request.body.name, request.body.phone );
        return Promise.resolve({
            status: SUCCESS
        })
    }, true );
});

// Get users
app.get("/user", async function(request, response) {
    await action( request, response, true, async ( request, user ) => {
        let users = await getUsers();
        return Promise.resolve({
            status: SUCCESS,
            users: users
        })
    }, true );
});

// Update user
app.put("/user", async function(request, response) {
    await action( request, response, true, async ( request, user ) => {
        await updateUser( request.body.id, request.body.email, request.body.password, request.body.name, request.body.phone );
        return Promise.resolve({
            status: SUCCESS
        })
    }, true );
});

// delete user
app.delete("/user", async function(request, response) {
    await action( request, response, true, async ( request, user ) => {
        await deleteUser( request.query.id, user.id );
        return Promise.resolve({
            status: SUCCESS
        })
    }, true );
});

// give a user priority in the next drawing
app.post("/priority", async function(request, response) {
    await action( request, response, true, async ( request, user ) => {
        await giveDrawingPriorityInNextDrawing( request.body.id );
        return Promise.resolve({
            status: SUCCESS
        })
    }, true );
});

/**
 * Perform a standard action.
 * @param {Request} request - The request object.
 * @param {Response} response - The response object.
 * @param {boolean} [validateUser] - True if there must be a user.
 * @param {Function} successFunction - The function to run on success
 * @param {boolean} [validateAdmin] - True if the user must be an admin.
 */
async function action( request, response, validateUser, successFunction, validateAdmin ) {
    let code = HTTP_OK;
    let obj = {};
    try {
        let user;
        if( validateUser ) user = await validateToken(request.cookies[TOKEN_COOKIE], validateAdmin);
        try {
            obj = await successFunction( request, user );
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
}

main();

// Functions
async function main() {
    connection = await mysql.createConnection({
        host: process.env.MYSQL_HOST,
        user: process.env.MYSQL_USER,
        password: process.env.MYSQL_PASSWORD,
        database: process.env.MYSQL_DATABASE,
        port: process.env.MYSQL_PORT,
        timezone: new Date().toString().match(/([-\+][0-9]+)\s/)[1].replace(/(\d{2})$/, ":$1").replace(/\+/,"=").replace(/\-/,"+").replace(/=/,"-")
    });

    // script can be used to add a user with --email <email> --password <password> --name <name> --phone <phone>
    // dotenv helps with .env file - does what heroku does
    let args = minimist(process.argv.slice(2));
    if( args.email && args.password && args.name && args.phone ) {
        await addUser( args.email, args.password, args.name, args.phone );
        console.log("Inserted");
        return Promise.resolve();
    }

    app.listen(PORT);
    startDrawAtRightTime();
    startReportAtRightTime();
}

/**
 * Get a list of all users.
 * @returns {Promise<Array>} An array of all the users.
 */
async function getUsers() {
    let [rows, fields] = await connection.execute("SELECT id, name, email, phone FROM users");
    return Promise.resolve(rows.map(row => {
        return {
            id: row.id,
            name: row.name,
            email: row.email,
            phone: row.phone
        }
    }));
}

/**
 * Add user.
 * @param {string} email - The user email. 
 * @param {string} password - The user password.
 * @param {string} name - The user name.
 * @param {string} phone - The user phone.
 */
async function addUser( email, password, name, phone ) {
    if( !email || !password || !name || !phone ) return Promise.reject(ERROR_MESSAGES.missingUserFields);
    let result = passwordToHash(password);
    await connection.execute("INSERT INTO users(email,hash,salt,name,phone) VALUES(?,?,?,?,?)", [email,result.hash,result.salt,name,phone]);
    return Promise.resolve();
}

/**
 * Delete a user.
 * @param {string} id - The user id. 
 */
async function deleteUser( id, userId ) {
    if( !id ) return Promise.reject(ERROR_MESSAGES.noUserSpecified);
    if( id === userId ) return Promise.reject(ERROR_MESSAGES.cannotDeleteSelf);
    await connection.execute("DELETE FROM users WHERE id = ?", [id]);
    return Promise.resolve();
}

/**
 * Update a user.
 * @param {string} id - The user ID. 
 * @param {string} [email] - The email. 
 * @param {string} [password] - The password.
 * @param {name} [name] - The user name.
 * @param {phone} [phone] - The user phone.
 */
async function updateUser( id, email, password, name, phone ) {
    if( !id ) return Promise.reject(ERROR_MESSAGES.noUserSpecified);
    let queryParams = [];
    let queryParts = [];
    if( email ) {
        queryParts.push("email = ?");
        queryParams.push(email);
    }
    if( password ) {
        let result = passwordToHash( password );
        queryParts.push("hash = ?");
        queryParts.push("salt = ?");
        queryParams.push(result.hash);
        queryParams.push(result.salt);
    }
    if( name ) {
        queryParts.push("name = ?");
        queryParams.push(name);
    }
    if( phone ) {
        queryParts.push("phone = ?");
        queryParams.push(phone);
    }
    if( queryParams.length ) {
        let query = "UPDATE users SET " + queryParts.join(",") + " WHERE id = ?";
        queryParams.push(id);
        await connection.execute(query, queryParams);
    }
    return Promise.resolve();
}

/**
 * Convert a password to a hash.
 * @param {string} password - The password.
 * @returns {Object} An object with a key for salt and hash.
 */
function passwordToHash( password ) {
    let salt = crypto.randomBytes(20).toString('hex');
    let hash = crypto.scryptSync(password, salt, CRYPTO_KEY_LEN).toString("hex");
    return {
        salt: salt,
        hash: hash
    };
}

/**
 * Check in or check out from a location.
 * @param {number} locationId - The id of the location.
 * @param {number} userId - The id of the person punching.
 * @param {boolean} [force] - Force check out even during a draw.
 * @param {string} [guest] - A name for a guest.
 * @returns {Promise} - A resolved promise.
 */
async function check(locationId, userId, force, guest) {
    if( !locationId || !userId ) return Promise.reject(ERROR_MESSAGES.noLocationOrUser );
    let [rows, fields] = await connection.execute("SELECT count(1) AS count FROM checks WHERE user_id != ? AND location_id = ? ORDER BY created DESC", [userId, locationId]);
    // Make sure some one else isn't punched in
    if( rows[0].count % 2 === 1 ) {
        return Promise.reject(ERROR_MESSAGES.someoneElsePunchedIn);
    }
    // Make sure we're not punched in anywhere else
    [rows, fields] = await connection.execute("SELECT location_id, count(1) AS count FROM checks WHERE user_id = ? AND location_id != ? GROUP BY location_id HAVING MOD(count, 2) = 1", [userId, locationId]);
    if( rows.length >= maxPlaces ) return Promise.reject(ERROR_MESSAGES.signedInSomewhereElse);
    else if( maxPlaces > 1 && rows.length && !force ) {
        // have to make sure the place that we want borders the places that we are signed into - it just needs to border one
        let bordersOne = false;
        for( let row of rows ) {
            let [subrows, subfields] = await connection.execute("SELECT id FROM borders where (location_id_a = ? OR location_id_b = ?) AND (location_id_a = ? OR location_id_b = ?)", [locationId, locationId, row.location_id, row.location_id]);
            if( subrows.length ) {
                bordersOne = true;
                break;
            }
        }
        if( !bordersOne ) return Promise.reject(ERROR_MESSAGES.notBordering);
        // we also have to make sure that when signing out, the remaining rows will still all border each other.
        // we'll start at the first location, then look at what it borders. If it borders one we need (i.e. one of the remaining rows),
        // we'll mark it as visited and repeat the process with that location.
        // The maximum number of requests is neededLocations.length so that will be 3 when we have a max of four locations (as one will be the location we are punching)
        let borderingLocations = [rows[0].location_id];
        let neededLocations = rows.map(el => el.location_id);
        let maxDepth = rows.length - 1;
        let findBorders = async (current, depth) => {
            let [subrows, subfields] = await connection.execute("SELECT location_id_a, location_id_b FROM borders where (location_id_a = ? OR location_id_b = ?)", [current, current]);
            subrows = subrows.filter( subrow => { // filter the rows to be only the ones we need
                subrow.location_id = subrow.location_id_a === current ? subrow.location_id_b : subrow.location_id_a; // get the "other" location id
                return borderingLocations.indexOf(subrow.location_id) === -1
                    && neededLocations.indexOf(subrow.location_id) !== -1
            } );
            for( let subrow of subrows ) {
                if( borderingLocations.indexOf(subrow.location_id) === -1 ) { // even though we check above, the previous subrow's child search may have added it
                    borderingLocations.push( subrow.location_id );
                    if( depth < maxDepth ) await findBorders( subrow.location_id, depth+1 );
                }
            }
        };
        if( borderingLocations.length !== neededLocations.length ) await findBorders(borderingLocations[0], 0); // run the findBorders function if we have to
        if( borderingLocations.length !== neededLocations.length ) return Promise.reject(ERROR_MESSAGES.chainBroken);
    }

    // Drawing check
    if( !force && drawHappening ) {
        let status = await currentDrawingStatus( userId );
        if( status.drawOrder === null || status.drawOrder !== drawIndex ) {
            return Promise.reject(ERROR_MESSAGES.notYourTurn);
        }

        [rows, fields] = await connection.execute("SELECT count(1) AS count FROM checks WHERE user_id = ? AND location_id = ? ORDER BY created DESC", [userId, locationId]);
        // We're checking out
        if( rows[0].count % 2 === 1 ) {
            drawChecksForUser--; // perhaps an accident
        }
        else {
            drawChecksForUser++;
        }
    }

    // Deer season check - 2 punches allowed per day
    // integer divide by 2 to get check ins per location
    if( !force && month >= DEER_SEASON_START ) {
        [rows, fields] = await connection.execute("SELECT count(1) AS count FROM checks WHERE user_id = ? AND location_id = ? ORDER BY created DESC", [userId, locationId]);
        // We're checking in
        if( rows[0].count % 2 !== 1 ) {
            [rows, fields] = await connection.execute("SELECT SUM(count) AS count FROM (SELECT location_id, CEIL(count(1)/2) AS count FROM checks WHERE user_id = ? AND DATE(created) = CURDATE() GROUP BY location_id) AS checkins_by_location", [userId]);
            if( rows[0].count >= MAX_SIGNINS_DURING_DEER_SEASON ) {
                return Promise.reject(ERROR_MESSAGES.deerSeasonMaxSignIns);
            }
        }
    }

    if( !guest ) guest = null; // don't bother with blank rows in the db
    await connection.execute("INSERT INTO checks(location_id,user_id,guest) VALUES (?,?,?)", [locationId,userId,guest]);
    if( !force && drawHappening && drawChecksForUser === maxPlaces ) advancePick();
    return Promise.resolve();
}

/**
 * Skip your spot in the draw.
 */
async function skip( userId ) {
    if( !drawHappening ) return Promise.reject(ERROR_MESSAGES.drawNotHappening);
    let status = await currentDrawingStatus( userId );
    if( status.drawOrder === null || status.drawOrder !== drawIndex ) {
        return Promise.reject(ERROR_MESSAGES.notYourTurn);
    }
    advancePick();
    return Promise.resolve();
}

/**
 * Check into a physical location.
 * @param {number} lat - The latitude. 
 * @param {number} lng - The longitude.
 * @param {string} userId - The id of the user.
 * @returns {Promise<string>} - A promise containing a descriptive message of where the user checked in. 
 */
async function physical( lat, lng, userId ) {

    let [rows, fields] = await connection.execute("SELECT id, name, center_lat, center_lng, valid_radius FROM maps");
    for( let row of rows ) {
        let distanceBetween = distance( lat, lng, row.center_lat, row.center_lng );
        if( distanceBetween <= row.valid_radius ) {
            await connection.execute("INSERT INTO physicals(map_id, user_id) VALUES (?,?)", [row.id, userId]);
            return Promise.resolve("Checked into " + row.name);
        }
    }
    return Promise.reject(ERROR_MESSAGES.notWithinAnyMap);

}

/**
 * Generate a report of who didn't physically check into a location they checked into.
 */
async function performViolatorsReport() {
    // this might get people who sign out the next day as well - perhaps a good thing
    let [rows, fields] = await connection.execute("SELECT users.id AS user_id, users.name AS user_name, users.email AS user_email, users.phone AS user_phone, locations.id AS location_id, locations.name AS location_name, maps.id AS map_id, maps.name AS map_name FROM users JOIN checks ON users.id = checks.user_id JOIN locations ON checks.location_id = locations.id JOIN maps ON locations.map_id = maps.id LEFT OUTER JOIN physicals ON locations.map_id = physicals.map_id WHERE physicals.id is null AND DATE(checks.created) = CURDATE()");
    let report = rows.map( row => {
        return `<tr><td>${row.user_name}</td><td>${row.user_email}</td><td>${row.user_phone}</td><td>${row.map_name}</td><td>${row.location_name}</td></tr>`;
    }).join("");
    if( !rows.length ) report = "No violators today.";
    else report = `<table border="1" cellpadding="5"><thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Map</th><th>Location</th></tr></thead><tbody>${report}</tbody></table>`;
    report = `<h1>Violators Report</h1>${report}`;

    let smtp = nodemailer.createTransport({
        host: process.env.MAILER_HOST,
        port: process.env.MAILER_PORT,
        auth: {
            user: process.env.MAILER_EMAIL,
            pass: process.env.MAILER_PASSWORD
        }
    });
    smtp.sendMail({
        from: '"Hunt Club Mail" <huntclubmail@gmail.com>',
        to: process.env.ADMIN_EMAIL,
        subject: "Violators Report - " + new Date().toLocaleDateString(),
        html: report
    });
    console.log("mail sent");
}

/**
 * Get the distance between two coordinates in miles.
 * https://stackoverflow.com/questions/27928/calculate-distance-between-two-latitude-longitude-points-haversine-formula
 * @param {number} lat1 - The first latitude. 
 * @param {number} lon1 - The first longitude.
 * @param {number} lat2 - The second latitude.
 * @param {number} lon2 - The second longitude.
 * @returns {number} The distance in miles.
 */
function distance(lat1, lon1, lat2, lon2) {
    let p = 0.017453292519943295;    // Math.PI / 180
    let c = Math.cos;
    let a = 0.5 - c((lat2 - lat1) * p)/2 + 
            c(lat1 * p) * c(lat2 * p) * 
            (1 - c((lon2 - lon1) * p))/2;
  
    return 7918 * Math.asin(Math.sqrt(a)); // 2 * R; R = 3959 m (radius of earth in miles)
  }

/**
 * Check the current status of the magnet board.
 * @param {number} mapId - The ID of the map.
 * @returns {Promise<Object>} - A resolved promise containing an object with locations as keys and people as values.
 */
async function status( mapId ) {
    if( !mapId ) return Promise.reject(ERROR_MESSAGES.noMapSpecified);
    // counts on id being in order of when created
    let [rows, fields] = await connection.execute("SELECT users.id as user_id, locations.id as location_id, users.name as user_name, users.phone as user_phone, locations.name as location, x, y, guest FROM (SELECT max(id) as id, count(1) as count FROM checks group by location_id having MOD(count, 2) = 1) AS ids JOIN checks on checks.id = ids.id JOIN users ON checks.user_id = users.id RIGHT OUTER JOIN locations ON checks.location_id = locations.id WHERE locations.map_id = ?", [mapId]);
    let locations = {};
    for( let row of rows ) {
        locations[row.location_id] = {
            user: {
                id: row.user_id,
                name: row.user_name,
                phone: row.user_phone,
                guest: row.guest
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
 * Get the past 300 messages from chat.
 * @returns {Promise<Array>} A promise containing an array of objects with chat info.
 */
async function getChat() {
    let [rows, fields] = await connection.execute("SELECT users.name AS user_name, messages.created AS created, content FROM messages JOIN users ON messages.user_id = users.id ORDER BY messages.created ASC LIMIT 300");
    let results = rows.map( row => {
        return {
            user: row.user_name,
            created: row.created.toLocaleString("en-US", {timeZone: "UTC"}), // we are operating in EST, so we don't want the date to change -- timezone UTC
            content: row.content
        }
    });
    return Promise.resolve(results);
}

/**
 * Post a message to chat.
 * @param {string} userId - The user ID.
 * @param {string} message - The message to post. 
 */
async function postChat( userId, message ) {
    if( !message ) return Promise.reject(ERROR_MESSAGES.noChatMessage);
    let [rows, fields] = await connection.execute("INSERT INTO messages(user_id, content) VALUES (?,?)", [userId, message]);
    return Promise.resolve();
}

/**
 * Grant a user priority drawing in the next drawing.
 * @param {string} userId - The user ID. 
 */
async function giveDrawingPriorityInNextDrawing( userId ) {
    if( drawLock ) return Promise.reject(ERROR_MESSAGES.drawProcessing);
    await connection.execute("UPDATE drawings SET priority = true WHERE user_id = ?", [userId]);
    return Promise.resolve();
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
    [rows, fields] = await connection.execute("SELECT id, user_id, priority FROM drawings WHERE draw_order is null");
    let priorityRows = shuffle(rows.filter( row => row.priority ));
    let normalRows = shuffle(rows.filter( row => !row.priority ));
    drawEntrants = [...priorityRows, ...normalRows];
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
    drawChecksForUser = 0;

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

    let [rows, fields] = await connection.execute("SELECT id, email, hash, salt, name, phone, admin FROM users WHERE email = ?", [email]);
    if( !rows.length ) return Promise.reject(ERROR_MESSAGES.accountDoesNotExist);
    let user = rows[0];
    
    if(user.hash) {
        if( crypto.scryptSync(password, user.salt, CRYPTO_KEY_LEN).toString("hex") == user.hash ) {
            let id = {"id": user.id, "email": user.email};
            let token = jwt.sign( id, TOKEN_KEY, TOKEN_OPTIONS );
            id.name = user.name;
            id.phone = user.phone;
            id.admin = user.admin;
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
 * @param {boolean} [asAdmin] - True if we want to validate the user as an admin.
 * @returns {Promise<Object>} - A promise containing the decrypted object or a rejected promise with an error message.
 */
async function validateToken( token, asAdmin ) {
    if( token ) {
        try {
            let result = jwt.verify( token, TOKEN_KEY, TOKEN_OPTIONS );
            let rows, fields;
            if( !asAdmin ) [rows, fields] = await connection.execute("SELECT id FROM users WHERE id = ?", [result.id]);
            else [rows, fields] = await connection.execute("SELECT id FROM users WHERE id = ? AND admin = true", [result.id]);
            if( !rows.length ) return Promise.reject(ERROR_MESSAGES.invalidToken);
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
        // we only do a drawing in turkey season or deer season
        let m = new Date().getMonth();
        if( m >= TURKEY_SEASON_START && m <= TURKEY_SEASON_END && m >= DEER_SEASON_START ) performDrawing();
        setTimeout( startDrawAtRightTime, 1000 ); // wait a second just to be safe that we don't double send.
    }, millisTilSend);
}

/**
 * Send Violators report at 10pm each day.
 */
function startReportAtRightTime() {
    let now = new Date();
    // send at 5am
    // be sure TZ is set properly in heroku's environment variables - we are on eastern time, so that's when our sign up is
    let millisTilSend = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 22, 0, 0, 0) - now;
    if (millisTilSend < 0) {
        millisTilSend += 86400000; // it's after 10pm, try 10pm tomorrow.
    }
    setTimeout( () => {
        console.log("starting report");
        performViolatorsReport();
        setTimeout( startReportAtRightTime, 1000 ); // wait a second just to be safe that we don't double send.
    }, millisTilSend);
}