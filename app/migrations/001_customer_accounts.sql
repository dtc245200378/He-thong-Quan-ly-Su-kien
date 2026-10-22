BEGIN;

CREATE TABLE IF NOT EXISTS customer_users (
    id BIGSERIAL PRIMARY KEY,
    full_name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL,
    password_hash TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    failed_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS
    customer_users_email_unique
ON customer_users (LOWER(email));

ALTER TABLE attendees
ADD COLUMN IF NOT EXISTS customer_user_id BIGINT
REFERENCES customer_users(id)
ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS
    attendees_customer_user_id_idx
ON attendees(customer_user_id);

COMMIT;
