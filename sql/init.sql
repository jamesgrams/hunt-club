CREATE TABLE users (
    id int unsigned not null auto_increment,
    created timestamp default now(),
    modified timestamp default now() on update now() not null,
    email varchar(255) not null,
    hash varchar(256) not null,
    salt varchar(128) not null,
    name varchar(200) not null,
    phone varchar(12) not null,
    constraint pk_users primary key(id)
);

CREATE INDEX idx_users_email ON users(email);

CREATE TABLE maps (
    id int unsigned not null auto_increment,
    name varchar(100) not null,
    image_src varchar(100) not null,
    circle_diameter float(53) not null,
    constraint pk_maps primary key(id)
);

CREATE TABLE locations (
    id int unsigned not null auto_increment,
    created timestamp default now(),
    modified timestamp default now() on update now() not null,
    name varchar(100) not null,
    map_id int unsigned not null,
    x float(53) unsigned not null,
    y float(53) unsigned not null,
    constraint pk_locations primary key(id),
    constraint fk_locations_maps foreign key (map_id) references maps(id)
);

CREATE INDEX idx_locations_map_id ON locations(map_id);

CREATE TABLE borders (
    id int unsigned not null auto_increment,
    location_id_a int unsigned not null,
    location_id_b int unsigned not null,
    constraint pk_borders primary key(id),
    constraint fk_borders_locations_a foreign key (location_id_a) references locations(id),
    constraint fk_borders_locations_b foreign key (location_id_b) references locations(id)
);

CREATE INDEX idx_borders_location_id_a ON borders(location_id_a);
CREATE INDEX idx_borders_location_id_b ON borders(location_id_b);

CREATE TABLE checks (
    id int unsigned not null auto_increment,
    created timestamp default now(),
    modified timestamp default now() on update now() not null,
    location_id int unsigned not null,
    user_id int unsigned not null,
    constraint pk_checks primary key(id),
    constraint fk_checks_users foreign key (user_id) references users(id),
    constraint fk_checks_locations foreign key (location_id) references locations(id)
);

CREATE INDEX idx_checks_location_id ON checks(location_id);
CREATE INDEX idx_checks_user_id ON checks(user_id);

CREATE TABLE drawings (
    id int unsigned not null auto_increment,
    created timestamp default now(),
    modified timestamp default now() on update now() not null,
    user_id int unsigned not null,
    draw_order int unsigned,
    constraint pk_drawings primary key(id),
    constraint fk_drawings_users foreign key (user_id) references users(id)
);

CREATE INDEX idx_drawings_user_id on drawings(user_id);