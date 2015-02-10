CREATE TABLE users (
  id bigint NOT NULL,
  username text NOT NULL,
  -- The timestamp indicates when we have seen the user for the first time.
  created timestamp with time zone DEFAULT now() NOT NULL
);
CREATE SEQUENCE users_id_seq
  START WITH 1
  INCREMENT BY 1
  NO MINVALUE
  NO MAXVALUE
  CACHE 1;
ALTER SEQUENCE users_id_seq OWNED BY users.id;


CREATE TABLE licks (
  id bigint NOT NULL,
  user_id bigint NOT NULL,
  message text NOT NULL,
  creator_id bigint NOT NULL,
  created timestamp with time zone DEFAULT now() NOT NULL
);
CREATE SEQUENCE licks_id_seq
  START WITH 1
  INCREMENT BY 1
  NO MINVALUE
  NO MAXVALUE
  CACHE 1;
ALTER SEQUENCE licks_id_seq OWNED BY licks.id;


CREATE TYPE UserClassEnum AS ENUM ('user', 'moderator', 'admin');

CREATE TABLE chats (
  id bigint NOT NULL,
  user_id bigint NOT NULL,
  message text NOT NULL,
  created timestamp with time zone DEFAULT now() NOT NULL
);
CREATE SEQUENCE chats_id_seq
  START WITH 1
  INCREMENT BY 1
  NO MINVALUE
  NO MAXVALUE
  CACHE 1;
ALTER SEQUENCE chats_id_seq OWNED BY chats.id;


CREATE TABLE mutes (
  id bigint NOT NULL,
  user_id bigint NOT NULL,
  moderator_id bigint NOT NULL,
  timespec text NOT NULL,
  shadow boolean DEFAULT false NOT NULL,
  created timestamp with time zone DEFAULT now() NOT NULL
);
CREATE SEQUENCE mutes_id_seq
  START WITH 1
  INCREMENT BY 1
  NO MINVALUE
  NO MAXVALUE
  CACHE 1;
ALTER SEQUENCE mutes_id_seq OWNED BY mutes.id;


CREATE TABLE unmutes (
  id bigint NOT NULL,
  user_id bigint NOT NULL,
  moderator_id bigint NOT NULL,
  shadow boolean DEFAULT false NOT NULL,
  created timestamp with time zone DEFAULT now() NOT NULL
);
CREATE SEQUENCE unmutes_id_seq
  START WITH 1
  INCREMENT BY 1
  NO MINVALUE
  NO MAXVALUE
  CACHE 1;
ALTER SEQUENCE unmutes_id_seq OWNED BY unmutes.id;


CREATE TABLE games (
  id bigint NOT NULL,
  game_crash bigint NOT NULL,
  seed text,
  created timestamp with time zone DEFAULT now() NOT NULL
);
CREATE SEQUENCE games_id_seq
  START WITH 1
  INCREMENT BY 1
  NO MINVALUE
  NO MAXVALUE
  CACHE 1;
ALTER SEQUENCE games_id_seq OWNED BY games.id;

CREATE TABLE plays (
  id bigint NOT NULL,
  user_id bigint NOT NULL,
  cash_out bigint,
  game_id bigint NOT NULL,
  bet bigint,
  bonus bigint
);
CREATE SEQUENCE plays_id_seq
  START WITH 1
  INCREMENT BY 1
  NO MINVALUE
  NO MAXVALUE
  CACHE 1;
ALTER SEQUENCE plays_id_seq OWNED BY plays.id;


ALTER TABLE ONLY users ALTER COLUMN id SET DEFAULT nextval('users_id_seq'::regclass);
ALTER TABLE ONLY licks ALTER COLUMN id SET DEFAULT nextval('licks_id_seq'::regclass);
ALTER TABLE ONLY chats ALTER COLUMN id SET DEFAULT nextval('chats_id_seq'::regclass);
ALTER TABLE ONLY mutes ALTER COLUMN id SET DEFAULT nextval('mutes_id_seq'::regclass);
ALTER TABLE ONLY games ALTER COLUMN id SET DEFAULT nextval('games_id_seq'::regclass);
ALTER TABLE ONLY plays ALTER COLUMN id SET DEFAULT nextval('plays_id_seq'::regclass);
ALTER TABLE ONLY unmutes ALTER COLUMN id SET DEFAULT nextval('unmutes_id_seq'::regclass);

ALTER TABLE ONLY users ADD CONSTRAINT users_pkey PRIMARY KEY (id);
ALTER TABLE ONLY licks ADD CONSTRAINT licks_pkey PRIMARY KEY (id);
ALTER TABLE ONLY chats ADD CONSTRAINT chats_pkey PRIMARY KEY (id);
ALTER TABLE ONLY mutes ADD CONSTRAINT mutes_pkey PRIMARY KEY (id);
ALTER TABLE ONLY games ADD CONSTRAINT games_pkey PRIMARY KEY (id);
ALTER TABLE ONLY plays ADD CONSTRAINT plays_pkey PRIMARY KEY (id);
ALTER TABLE ONLY unmutes ADD CONSTRAINT unmutes_pkey PRIMARY KEY (id);

CREATE INDEX licks_user_id_idx ON licks USING btree (user_id);
CREATE INDEX licks_creator_id_idx ON licks USING btree (creator_id);
CREATE INDEX chats_user_id_idx ON chats USING btree (user_id);
CREATE INDEX mutes_user_id_idx ON mutes USING btree (user_id);
CREATE INDEX mutes_moderator_id_idx ON mutes USING btree (moderator_id);
CREATE INDEX plays_game_id_idx ON plays USING btree (game_id);
CREATE INDEX plays_user_id_idx ON plays USING btree (user_id, id DESC);
CREATE UNIQUE INDEX unique_username ON users USING btree (lower(username));
CREATE INDEX user_id_idx ON users USING btree (id);
CREATE INDEX unmutes_user_id_idx ON unmutes USING btree (user_id);
CREATE INDEX unmutes_moderator_id_idx ON unmutes USING btree (moderator_id);

ALTER TABLE ONLY licks
  ADD CONSTRAINT licks_user_id_fkey
  FOREIGN KEY (user_id)
  REFERENCES users(id)
  ON UPDATE CASCADE
  ON DELETE CASCADE;

ALTER TABLE ONLY licks
  ADD CONSTRAINT licks_creator_id_fkey
  FOREIGN KEY (creator_id)
  REFERENCES users(id)
  ON UPDATE CASCADE
  ON DELETE CASCADE;

ALTER TABLE ONLY chats
  ADD CONSTRAINT chats_user_id_fkey
  FOREIGN KEY (user_id)
  REFERENCES users(id)
  ON UPDATE CASCADE
  ON DELETE CASCADE;

ALTER TABLE ONLY mutes
  ADD CONSTRAINT mutes_user_id_fkey
  FOREIGN KEY (user_id)
  REFERENCES users(id)
  ON UPDATE CASCADE
  ON DELETE CASCADE;

ALTER TABLE ONLY mutes
  ADD CONSTRAINT mutes_moderator_id_fkey
  FOREIGN KEY (moderator_id)
  REFERENCES users(id)
  ON UPDATE CASCADE
  ON DELETE CASCADE;

ALTER TABLE ONLY plays
  ADD CONSTRAINT plays_game_id_fkey
  FOREIGN KEY (game_id)
  REFERENCES games(id)
  ON UPDATE CASCADE
  ON DELETE CASCADE;

ALTER TABLE ONLY plays
  ADD CONSTRAINT plays_user_id_fkey
  FOREIGN KEY (user_id)
  REFERENCES users(id)
  ON UPDATE CASCADE
  ON DELETE CASCADE;

ALTER TABLE ONLY unmutes
  ADD CONSTRAINT unmutes_user_id_fkey
  FOREIGN KEY (user_id)
  REFERENCES users(id)
  ON UPDATE CASCADE
  ON DELETE CASCADE;

ALTER TABLE ONLY unmutes
  ADD CONSTRAINT unmutes_moderator_id_fkey
  FOREIGN KEY (moderator_id)
  REFERENCES users(id)
  ON UPDATE CASCADE
  ON DELETE CASCADE;
