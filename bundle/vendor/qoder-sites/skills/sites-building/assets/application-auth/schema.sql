-- Business data only. This example does not create user/session/OAuth tables.
CREATE TABLE app.app_notes (
  id uuid NOT NULL,
  owner_id text NOT NULL,
  title text NOT NULL,
  PRIMARY KEY (owner_id, id)
);
