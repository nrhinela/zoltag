"""Add pgvector-backed similarity acceleration.

Revision ID: 202602162200
Revises: 202602161900
Create Date: 2026-02-16 22:00:00.000000
"""

from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "202602162200"
down_revision: Union[str, None] = "202602161900"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return

    op.execute("CREATE EXTENSION IF NOT EXISTS vector")

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
                -- Default for current SigLIP embedding shape.
                embedding_dim := 1152;
            END IF;

            EXECUTE
                'ALTER TABLE image_embeddings
                 ADD COLUMN IF NOT EXISTS embedding_vec vector';

            EXECUTE format(
                'ALTER TABLE image_embeddings
                 ALTER COLUMN embedding_vec TYPE vector(%s)
                 USING CASE
                     WHEN embedding_vec IS NULL THEN NULL
                     ELSE embedding_vec::vector(%s)
                 END',
                embedding_dim,
                embedding_dim
            );

            EXECUTE format(
                'UPDATE image_embeddings
                 SET embedding_vec = embedding::vector(%s)
                 WHERE embedding IS NOT NULL
                   AND embedding_vec IS NULL
                   AND array_length(embedding, 1) = %s',
                embedding_dim,
                embedding_dim
            );

            EXECUTE format(
                'CREATE OR REPLACE FUNCTION sync_image_embeddings_vector()
                 RETURNS trigger AS $body$
                 BEGIN
                     IF NEW.embedding IS NULL THEN
                         NEW.embedding_vec := NULL;
                     ELSIF array_length(NEW.embedding, 1) = %s THEN
                         NEW.embedding_vec := NEW.embedding::vector(%s);
                     ELSE
                         -- Preserve write path if embedding dimensions change in future.
                         NEW.embedding_vec := NULL;
                     END IF;
                     RETURN NEW;
                 END;
                 $body$ LANGUAGE plpgsql',
                embedding_dim,
                embedding_dim
            );

            EXECUTE 'DROP TRIGGER IF EXISTS trg_sync_image_embeddings_vector ON image_embeddings';
            EXECUTE
                'CREATE TRIGGER trg_sync_image_embeddings_vector
                 BEFORE INSERT OR UPDATE OF embedding
                 ON image_embeddings
                 FOR EACH ROW
                 EXECUTE FUNCTION sync_image_embeddings_vector()';

            BEGIN
                EXECUTE
                    'CREATE INDEX IF NOT EXISTS idx_image_embeddings_embedding_vec_hnsw
                     ON image_embeddings USING hnsw (embedding_vec vector_cosine_ops)';
            EXCEPTION
                WHEN undefined_object OR feature_not_supported OR invalid_parameter_value THEN
                    EXECUTE
                        'CREATE INDEX IF NOT EXISTS idx_image_embeddings_embedding_vec_ivfflat
                         ON image_embeddings USING ivfflat (embedding_vec vector_cosine_ops) WITH (lists = 100)';
            END;
        END $$;
        """
    )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return

    op.execute("DROP INDEX IF EXISTS idx_image_embeddings_embedding_vec_hnsw")
    op.execute("DROP INDEX IF EXISTS idx_image_embeddings_embedding_vec_ivfflat")
    op.execute("DROP TRIGGER IF EXISTS trg_sync_image_embeddings_vector ON image_embeddings")
    op.execute("DROP FUNCTION IF EXISTS sync_image_embeddings_vector()")
    op.execute("ALTER TABLE image_embeddings DROP COLUMN IF EXISTS embedding_vec")
