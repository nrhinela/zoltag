"""add_asset_text_index_table

Revision ID: 202602171100
Revises: 202602162210
Create Date: 2026-02-17 11:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "202602171100"
down_revision: Union[str, None] = "202602162210"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    is_postgres = bind.dialect.name == "postgresql"

    uuid_type = postgresql.UUID(as_uuid=True) if is_postgres else sa.String(length=36)
    json_type = postgresql.JSONB(astext_type=sa.Text()) if is_postgres else sa.JSON()
    array_type = postgresql.ARRAY(sa.Float()) if is_postgres else sa.JSON()

    op.create_table(
        "asset_text_index",
        sa.Column("asset_id", uuid_type, sa.ForeignKey("assets.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("tenant_id", uuid_type, sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("search_text", sa.Text(), nullable=False, server_default=sa.text("''")),
        sa.Column("components", json_type, nullable=False, server_default=sa.text("'{}'::jsonb" if is_postgres else "'{}'")),
        sa.Column("search_embedding", array_type, nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("idx_asset_text_index_tenant", "asset_text_index", ["tenant_id"], unique=False)
    op.create_index("idx_asset_text_index_tenant_asset", "asset_text_index", ["tenant_id", "asset_id"], unique=False)

    if is_postgres:
        op.execute("CREATE EXTENSION IF NOT EXISTS vector")
        op.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_asset_text_index_search_tsv
            ON asset_text_index
            USING gin (to_tsvector('simple', coalesce(search_text, '')))
            """
        )
        op.execute(
            """
            DO $$
            DECLARE
                embedding_dim integer;
            BEGIN
                SELECT COALESCE(MAX(array_length(embedding, 1)), 0)
                INTO embedding_dim
                FROM image_embeddings
                WHERE embedding IS NOT NULL;

                IF embedding_dim <= 0 THEN
                    embedding_dim := 1152;
                END IF;

                EXECUTE
                    'ALTER TABLE asset_text_index
                     ADD COLUMN IF NOT EXISTS search_embedding_vec vector';

                EXECUTE format(
                    'ALTER TABLE asset_text_index
                     ALTER COLUMN search_embedding_vec TYPE vector(%s)
                     USING CASE
                         WHEN search_embedding_vec IS NULL THEN NULL
                         ELSE search_embedding_vec::vector(%s)
                     END',
                    embedding_dim,
                    embedding_dim
                );

                EXECUTE format(
                    'UPDATE asset_text_index
                     SET search_embedding_vec = search_embedding::vector(%s)
                     WHERE search_embedding IS NOT NULL
                       AND search_embedding_vec IS NULL
                       AND array_length(search_embedding, 1) = %s',
                    embedding_dim,
                    embedding_dim
                );

                EXECUTE format(
                    'CREATE OR REPLACE FUNCTION sync_asset_text_index_embedding_vec()
                     RETURNS trigger AS $body$
                     BEGIN
                         IF NEW.search_embedding IS NULL THEN
                             NEW.search_embedding_vec := NULL;
                         ELSIF array_length(NEW.search_embedding, 1) = %s THEN
                             NEW.search_embedding_vec := NEW.search_embedding::vector(%s);
                         ELSE
                             NEW.search_embedding_vec := NULL;
                         END IF;
                         RETURN NEW;
                     END;
                     $body$ LANGUAGE plpgsql',
                    embedding_dim,
                    embedding_dim
                );

                EXECUTE 'DROP TRIGGER IF EXISTS trg_sync_asset_text_index_embedding_vec ON asset_text_index';
                EXECUTE
                    'CREATE TRIGGER trg_sync_asset_text_index_embedding_vec
                     BEFORE INSERT OR UPDATE OF search_embedding
                     ON asset_text_index
                     FOR EACH ROW
                     EXECUTE FUNCTION sync_asset_text_index_embedding_vec()';

                BEGIN
                    EXECUTE
                        'CREATE INDEX IF NOT EXISTS idx_asset_text_index_embedding_vec_hnsw
                         ON asset_text_index USING hnsw (search_embedding_vec vector_cosine_ops)';
                EXCEPTION
                    WHEN undefined_object OR feature_not_supported OR invalid_parameter_value THEN
                        EXECUTE
                            'CREATE INDEX IF NOT EXISTS idx_asset_text_index_embedding_vec_ivfflat
                             ON asset_text_index USING ivfflat (search_embedding_vec vector_cosine_ops) WITH (lists = 100)';
                END;
            END $$;
            """
        )

    if is_postgres:
        op.execute(
            """
            INSERT INTO job_definitions (key, description, arg_schema, timeout_seconds, max_attempts, is_active)
            VALUES
              (
                'rebuild-asset-text-index',
                'Rebuild denormalized text search index documents for tenant assets',
                jsonb_build_object(
                  'type', 'object',
                  'properties', jsonb_build_object(
                    'asset_id', jsonb_build_object('type', 'string'),
                    'limit', jsonb_build_object('type', 'integer', 'minimum', 1),
                    'offset', jsonb_build_object('type', 'integer', 'minimum', 0, 'default', 0),
                    'include_embeddings', jsonb_build_object('type', 'boolean', 'default', true)
                  ),
                  'additionalProperties', false
                ),
                7200,
                2,
                true
              )
            ON CONFLICT (key) DO UPDATE
              SET is_active = true,
                  description = EXCLUDED.description,
                  arg_schema = EXCLUDED.arg_schema,
                  timeout_seconds = EXCLUDED.timeout_seconds,
                  max_attempts = EXCLUDED.max_attempts,
                  updated_at = now()
            """
        )
    else:
        op.execute(
            """
            INSERT INTO job_definitions (key, description, arg_schema, timeout_seconds, max_attempts, is_active)
            VALUES (
                'rebuild-asset-text-index',
                'Rebuild denormalized text search index documents for tenant assets',
                '{"type":"object","properties":{"asset_id":{"type":"string"},"limit":{"type":"integer","minimum":1},"offset":{"type":"integer","minimum":0,"default":0},"include_embeddings":{"type":"boolean","default":true}},"additionalProperties":false}',
                7200,
                2,
                1
            )
            ON CONFLICT(key) DO UPDATE SET
                is_active = 1,
                description = excluded.description,
                arg_schema = excluded.arg_schema,
                timeout_seconds = excluded.timeout_seconds,
                max_attempts = excluded.max_attempts
            """
        )


def downgrade() -> None:
    bind = op.get_bind()
    is_postgres = bind.dialect.name == "postgresql"

    if is_postgres:
        op.execute("DROP INDEX IF EXISTS idx_asset_text_index_embedding_vec_hnsw")
        op.execute("DROP INDEX IF EXISTS idx_asset_text_index_embedding_vec_ivfflat")
        op.execute("DROP INDEX IF EXISTS idx_asset_text_index_search_tsv")
        op.execute("DROP TRIGGER IF EXISTS trg_sync_asset_text_index_embedding_vec ON asset_text_index")
        op.execute("DROP FUNCTION IF EXISTS sync_asset_text_index_embedding_vec()")
        op.execute("ALTER TABLE asset_text_index DROP COLUMN IF EXISTS search_embedding_vec")

    op.drop_index("idx_asset_text_index_tenant_asset", table_name="asset_text_index")
    op.drop_index("idx_asset_text_index_tenant", table_name="asset_text_index")
    op.drop_table("asset_text_index")

    if is_postgres:
        op.execute(
            """
            UPDATE job_definitions
            SET is_active = false,
                updated_at = now()
            WHERE key = 'rebuild-asset-text-index'
            """
        )
    else:
        op.execute(
            """
            UPDATE job_definitions
            SET is_active = 0
            WHERE key = 'rebuild-asset-text-index'
            """
        )
