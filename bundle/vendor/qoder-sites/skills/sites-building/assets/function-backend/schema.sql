CREATE TABLE app.notes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_id text NOT NULL,
 idempotency_key uuid NOT NULL,
 title text NOT NULL,
 creation_title text NOT NULL,
 version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (owner_id, idempotency_key)
);
CREATE INDEX notes_owner_created_at_idx ON app.notes (owner_id, created_at);
CREATE TABLE app.attachments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 note_id uuid NOT NULL REFERENCES app.notes (id),
 owner_id text NOT NULL,
 object_path text NOT NULL UNIQUE,
 status text NOT NULL DEFAULT 'pending',
 created_at timestamptz NOT NULL DEFAULT now()
);
