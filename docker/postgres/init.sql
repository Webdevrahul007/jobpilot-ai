-- PostgreSQL init script
-- Runs once when the Docker volume is first created.
-- Prisma handles all table creation via migrations — this just ensures
-- the database and extensions are ready before the app connects.

-- Enable useful extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";  -- For fast LIKE/ILIKE searches on job titles

-- Log that init ran
DO $$
BEGIN
  RAISE NOTICE 'JobPilot database initialized successfully.';
END $$;
