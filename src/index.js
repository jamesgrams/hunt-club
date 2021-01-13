const express = require('express');
const mysql = require('mysql2/promise');

const PORT = process.env.PORT || 80;
const JSON_ENCODING = "application/json";
const MAX_FETCH_COUNT = 3;
const SUCCESS = "success";
const FAILURE = "failure";
const HTTP_OK = 200;
const HTTP_BAD = 500;

const ERROR_MESSAGES = {
    someoneElsePunchedIn: "Someone else is already at that location",
    signedInSomewhereElse: "You are signed in somewhere else"
}

// Setup app
const app = express();
app.use( express.json() );

// Make database connection
let connection;

// Endpoints
app.use("/assets/", express.static("assets"));

app.get("/status", async function(request, response) {
    let obj = {};
    let code = HTTP_OK;
    try {
        obj = await status();
        obj = { 
            locations : obj,
            status: SUCCESS
        };
    }
    catch(err) {
        code = HTTP_BAD;
        console.log(err);
        obj = {
            status: FAILURE,
            message: err.message || err
        }
    }
    response.set({ 'content-type':  JSON_ENCODING });
    response.writeHead(code);
    response.end( JSON.stringify(obj) );
});

app.post("/check", async function(request, response) {
    let obj = {};
    let code = HTTP_OK;
    try {
        await check( request.body.location, request.body.name );
        obj = Object.assign( obj, {
            status: SUCCESS
        });
    }
    catch(err) {
        code = HTTP_BAD;
        console.log(err);
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
    app.listen(PORT);
}

/**
 * Check in or check out from a location.
 * @param {string} location - The name of the location.
 * @param {string} name - The name of the person punching.
 * @returns {Promise} - A resolved promise.
 */
async function check(location, name) {
    name = normalizeName(name);
    let [rows, fields] = await connection.execute("SELECT count(1) AS count FROM punches WHERE name != ? AND location = ? ORDER BY created DESC", [name, location]);
    // Make sure some one else isn't punched in
    if( rows[0].count % 2 === 1 ) {
        return Promise.reject(ERROR_MESSAGES.someoneElsePunchedIn);
    }
    // Make sure we're not punched in anywhere else
    [rows, fields] = await connection.execute("SELECT location, count(1) AS count FROM punches WHERE name = ? AND location != ? GROUP BY location HAVING MOD(count, 2) = 1", [name, location]);
    if( rows.length ) return Promise.reject(ERROR_MESSAGES.signedInSomewhereElse);
    await connection.execute("INSERT INTO punches(location,name) VALUES (?,?)", [location,name]);
    return Promise.resolve();
}

/**
 * Check the current status of the magnet board.
 * @returns {Promise<Object>} - A resolved promise containing an object with locations as keys and people as values.
 */
async function status() {
    // counts on id being in order of when created
    let [rows, fields] = await connection.execute("SELECT name, location FROM (SELECT max(id) as id, count(1) as count FROM punches group by location having MOD(count, 2) = 1) AS ids join punches on punches.id = ids.id", []);
    let locations = {};
    for( let row of rows ) {
        locations[row.location] = titleCase(row.name);
    }
    return Promise.resolve(locations);
}

/**
 * Normalize a name.
 * @param {string} name - The name to normalize.
 * @returns {string} The normalized name. 
 */
function normalizeName( name ) {
    return name.trim().toLowerCase();
}

/**
 * Title Case a name.
 * @param {string} name - The name to title case.
 * @returns {string} The title cased name. 
 */
function titleCase( name ) {
    return name.toLowerCase().split(' ').map((s) => s.charAt(0).toUpperCase() + s.substring(1)).join(' ');
}