# Hunt Club
This is a tool that can be used to serve as a check in system for hunting locations. A digital magnet board.

## Features
Hunt Club will let a user log in, sign in and out from locations, and enter drawings. Drawings take place at 5am and restrict who is allowed to pick spots.

## Admin Features
1. To add a user, run `node src\index.js --email <email> --password <password> --name <name> --phone <phone>
2. You can give people priority in a drawings - currently this must be done in the database by setting the priority column to true.
3. There is also a web-based admin section where you can perform CRUD operations with users and give them a priority pass for the next drawing. Note: they must have already entered the next drawing to get a priority pass.
4. To make someone an admin, set the admin flag to true in the `users` database table.

## Setup
1. Clone this repository
2. Make sure you have node && npm installed
3. `cd` to this repository
4. `npm install`
5. Make sure you have a connection to a MySQL database. Run the contents of `sql/init.sql` on that database and optionally `sql/main.sql` as well.
6. Set environment variables or create a `.env` file (in this repo's directory) for:
    1. `MYSQL_HOST`
    2. `MYSQL_PORT`
    3. `MYSQL_USER`
    4. `MYSQL_DATABASE`
    5. `MYSQL_PASSWORD`
    6. `TOKEN KEY` - A random string
    7. `TZ` - The timezone (e.g. America/New_York) - this is very important as there are specific times the program operates at such as drawings
    8. `MAILER_HOST`
    9. `MAILER_EMAIL`
    10. `MAILER_PORT`
    11. `MAILER_PASSWORD`,
    12. `ADMIN_EMAIL`
    13. `NODE_ENV` - (Set to development to avoid https redirect)
    14. `MAILER_SECURE` - (Optional if you want to use secure email)

## Developer Tips
1. When loading in a map, try to make it similar size to the other ones. You should also calculate the circle diameter in percentage of the total map with for the clickable circles.
2. After you've inserted the map into the database, if you click a circle, it will log coordinates to the console to make inserting locations easier.
3. You'll have to insert borders manually - see `sql/main.sql` for a typical setup.