CREATE TABLE punches(
    id int unsigned not null auto_increment,
    created timestamp default now(),
    modified timestamp default now() on update now() not null,
    location varchar(100) not null,
    name varchar(100) not null,
    constraint pk_locations primary key(id)
);

CREATE INDEX idx_punches_location ON punches(location);
CREATE INDEX idx_punches_name ON punches(name);