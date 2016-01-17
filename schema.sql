CREATE TABLE users (
  id bigserial NOT NULL PRIMARY KEY,
  username text NOT NULL,
  gross_profit bigint DEFAULT 0 NOT NULL,
  net_profit bigint DEFAULT 0 NOT NULL,
  games_played bigint DEFAULT 0 NOT NULL,
  -- The timestamp indicates when we have seen the user for the first time.
  created timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE licks (
  id bigserial NOT NULL PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES users(id),
  message text NOT NULL,
  creator_id bigint NOT NULL REFERENCES users(id),
  created timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TYPE UserClassEnum AS ENUM ('user', 'moderator', 'admin');

CREATE TABLE chats (
  id bigserial NOT NULL PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES users(id),
  channel text NOT NULL,
  message text NOT NULL,
  is_bot boolean NOT NULL,
  created timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX unique_chats_user_created ON chats USING btree (user_id, created);

CREATE TABLE mutes (
  id bigserial NOT NULL PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES users(id),
  moderator_id bigint NOT NULL REFERENCES users(id),
  timespec text NOT NULL,
  shadow boolean DEFAULT false NOT NULL,
  created timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE unmutes (
  id bigserial NOT NULL PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES users(id),
  moderator_id bigint NOT NULL REFERENCES users(id),
  shadow boolean DEFAULT false NOT NULL,
  created timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE games (
  id bigint NOT NULL PRIMARY KEY,
  game_crash bigint NOT NULL,
  seed text,
  created timestamp with time zone DEFAULT now() NOT NULL,
  started timestamp with time zone NULL
);

CREATE TABLE plays (
  id bigserial NOT NULL PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES users(id),
  cash_out bigint,
  game_id bigint NOT NULL REFERENCES games(id),
  bet bigint NOT NULL,
  bonus bigint,
  joined timestamp with time zone NULL
);

CREATE INDEX licks_user_id_idx ON licks USING btree (user_id);
CREATE INDEX licks_creator_id_idx ON licks USING btree (creator_id);
CREATE INDEX chats_user_id_idx ON chats USING btree (user_id, created DESC);
CREATE INDEX mutes_user_id_idx ON mutes USING btree (user_id);
CREATE INDEX mutes_moderator_id_idx ON mutes USING btree (moderator_id);
CREATE INDEX plays_game_id_idx ON plays USING btree (game_id);
CREATE INDEX plays_user_id_idx ON plays USING btree (user_id, id DESC);
CREATE UNIQUE INDEX unique_username ON users USING btree (lower(username));
CREATE INDEX user_id_idx ON users USING btree (id);
CREATE INDEX unmutes_user_id_idx ON unmutes USING btree (user_id);
CREATE INDEX unmutes_moderator_id_idx ON unmutes USING btree (moderator_id);
CREATE UNIQUE INDEX unique_plays_game_user ON plays USING btree (user_id, game_id);

-- Game crash table

-- This is derived data to have fast lookups of game crashes without
-- doing a linear scan through the games table. Fill this table
-- initially with
--   INSERT INTO game_crashes
--     (SELECT game_crash,MAX(id)
--        FROM games
--        GROUP BY game_crash);

CREATE TABLE game_crashes (
  game_crash bigint NOT NULL PRIMARY KEY,
  id bigint NOT NULL REFERENCES games(id)
);

CREATE UNIQUE INDEX game_crashes_crash_idx
  ON game_crashes
  USING btree (game_crash);

CREATE UNIQUE INDEX game_crashes_id_idx
  ON game_crashes
  USING btree (id DESC);


CREATE FUNCTION game_crash_trigger() RETURNS trigger AS
$$
BEGIN
  LOOP
    -- First try to update the key.
    UPDATE game_crashes
      SET id = CASE WHEN NEW.id > id
                 THEN NEW.id
                 ELSE id
               END
      WHERE game_crash = NEW.game_crash;
    IF found THEN RETURN NEW; END IF;
    -- Not there, so try to insert the key. If someone else inserts
    -- the same key concurrently, we could get a unique-key failure.
    BEGIN
      INSERT INTO game_crashes(game_crash,id) VALUES (NEW.game_crash, NEW.id);
      RETURN NEW;
    EXCEPTION WHEN unique_violation THEN
    -- Do nothing, and loop to try the UPDATE again.
    END;
  END LOOP;
END;
$$
LANGUAGE plpgsql;

CREATE TRIGGER game_crash_trigger
  AFTER INSERT ON games
  FOR EACH ROW EXECUTE PROCEDURE game_crash_trigger();

CREATE TABLE automutes (
  id bigserial NOT NULL PRIMARY KEY,
  creator_id bigint NOT NULL REFERENCES users(id),
  created timestamp with time zone DEFAULT now() NOT NULL,
  regexp text NOT NULL,
  enabled boolean DEFAULT true NOT NULL
);

CREATE TABLE blocks (
  height integer NOT NULL,
  hash text NOT NULL,
  confirmation timestamp with time zone DEFAULT now() NOT NULL,
  notification timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE ONLY blocks
  ADD CONSTRAINT bv_blocks_pkey
  PRIMARY KEY (height, hash);

CREATE TABLE blocknotifications (
  username text NOT NULL,
  channel_name text NOT NULL
);
ALTER TABLE blocknotifications
  ADD CONSTRAINT bv_blocknotifications_pkey
  PRIMARY KEY (username, channel_name);

CREATE OR REPLACE FUNCTION userstats_trigger()
  RETURNS trigger AS $$

  DECLARE
    delta_user_id bigint;
    delta_gross_profit bigint;
    delta_net_profit bigint;
    delta_games_played bigint;

  -- Work out the increment/decrement amount(s).
  BEGIN
    IF (TG_OP = 'INSERT') THEN
      delta_user_id = NEW.user_id;
      delta_gross_profit = COALESCE(NEW.cash_out-NEW.bet,0::numeric) + COALESCE(NEW.bonus,0::numeric);
      delta_net_profit   = COALESCE(NEW.cash_out, 0::numeric) + COALESCE(NEW.bonus, 0::numeric) - NEW.bet;
      delta_games_played = 1;
    ELSIF (TG_OP = 'DELETE') THEN
      delta_user_id = OLD.user_id;
      delta_gross_profit = - (COALESCE(OLD.cash_out-OLD.bet,0::numeric) + COALESCE(OLD.bonus,0::numeric));
      delta_net_profit   = - (COALESCE(OLD.cash_out, 0::numeric) + COALESCE(OLD.bonus, 0::numeric) - OLD.bet);
      delta_games_played = - 1;
    ELSIF (TG_OP = 'UPDATE') THEN
      IF ( OLD.user_id != NEW.user_id) THEN
        RAISE EXCEPTION
          'Update of user_id : % -> % not allowed', OLD.user_id, NEW.user_id;
      END IF;

      delta_user_id = OLD.user_id;
      delta_gross_profit =
          COALESCE(NEW.cash_out-NEW.bet,0::numeric) + COALESCE(NEW.bonus,0::numeric)
        - (COALESCE(OLD.cash_out-OLD.bet,0::numeric) + COALESCE(OLD.bonus,0::numeric));
      delta_net_profit   =
          COALESCE(NEW.cash_out, 0::numeric) + COALESCE(NEW.bonus, 0::numeric) - NEW.bet
        - (COALESCE(OLD.cash_out, 0::numeric) + COALESCE(OLD.bonus, 0::numeric) - OLD.bet);
      delta_games_played = 0;
    END IF;

    UPDATE users
      SET gross_profit = gross_profit + delta_gross_profit,
          net_profit   = net_profit + delta_net_profit,
          games_played = games_played + delta_games_played
      WHERE id = delta_user_id;

    RETURN NEW;
  END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER userstats_trigger
AFTER INSERT OR UPDATE OR DELETE ON plays
    FOR EACH ROW EXECUTE PROCEDURE userstats_trigger();

CREATE OR REPLACE FUNCTION userIdOf(text) RETURNS bigint AS $$
  SELECT id FROM users WHERE lower(username) = lower($1)
$$ LANGUAGE SQL STABLE;

CREATE OR REPLACE VIEW plays_view AS
  SELECT
    game_id,
    g.game_crash,
    g.created,
    username,
    user_id,
    bet,
    cash_out,
    bonus,
    COALESCE(cash_out,0) - bet + COALESCE(bonus,0) AS profit,
    100*cash_out/bet AS factor
FROM games g JOIN plays ON g.id = plays.game_id JOIN users ON user_id = users.id;
