# Postgres 17 with the pgaudit extension (required by 001_schema.sql and the
# shared_preload_libraries=pgaudit setting in docker-compose). The official
# alpine image does not ship pgaudit, so we use the Debian image + PGDG package.
FROM postgres:17
RUN apt-get update \
 && apt-get install -y --no-install-recommends postgresql-17-pgaudit \
 && rm -rf /var/lib/apt/lists/*
