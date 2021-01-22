# Hunt Club
This is a tool that can be used to serve as a check in system for hunting locations. A digital magnet board.

## Features
Hunt Club will let a user log in, sign in and out from locations, and enter drawings. Drawings take place at 5am and restrict who is allowed to pick spots.

## Admin Features
1. To add a user, run `node src\index.js --email <email> --password <password> --name <name> --phone <phone>
2. You can give people priority in a drawings - currently this must be done in the database by setting the priority column to true.

## Setup
1. Clone this repository
2. Make sure you have node && npm installed
3. `cd` to this repository
4. `npm install`
5. Make sure you have a connection to a MySQL database. Run the contents of `sql/init.sql` on that database and optionally `sql/main.sql` as well.
6. Set environment variables or create a `.env` file (in this repo's directory) for:
    a. `MYSQL_HOST`
    b. `MYSQL_PORT`
    c. `MYSQL_USER`
    d. `MYSQL_DATABASE`
    e. `MYSQL_PASSWORD`
    f. `TOKEN KEY` - A random string
    g. `TZ` - The timezone (e.g. America/New_York) - this is very important as there are specific times the program operates at such as drawings
    h. `MAILER_HOST`
    i. `MAILER_EMAIL`
    f. `MAILER_PORT`
    g. `MAILER_PASSWORD`,
    i. `ADMIN_EMAIL`

## Developer Tips
1. When loading in a map, try to make it similar size to the other ones. You should also calculate the circle diameter in percentage of the total map with for the clickable circles.
2. After you've inserted the map into the database, if you click a circle, it will log coordinates to the console to make inserting locations easier.
3. You'll have to insert borders manually - see `sql/main.sql` for a typical setup.