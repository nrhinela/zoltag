"""add face recognition job definitions

Revision ID: 202602192230
Revises: 202602192100
Create Date: 2026-02-19 22:30:00.000000
"""

from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "202602192230"
down_revision: Union[str, None] = "202602192100"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    is_postgres = bind.dialect.name == "postgresql"

    if is_postgres:
        op.execute(
            """
            INSERT INTO job_definitions (key, description, arg_schema, timeout_seconds, max_attempts, is_active)
            VALUES
              (
                'recompute-face-detections',
                'Refresh detected face encodings for tenant images',
                jsonb_build_object(
                  'type', 'object',
                  'properties', jsonb_build_object(
                    'batch_size', jsonb_build_object('type', 'integer', 'minimum', 1, 'default', 25),
                    'limit', jsonb_build_object('type', 'integer', 'minimum', 1),
                    'offset', jsonb_build_object('type', 'integer', 'minimum', 0, 'default', 0),
                    'replace', jsonb_build_object('type', 'boolean', 'default', false)
                  ),
                  'additionalProperties', false
                ),
                10800,
                2,
                true
              ),
              (
                'recompute-face-recognition-tags',
                'Recompute face-recognition machine tag suggestions from person references',
                jsonb_build_object(
                  'type', 'object',
                  'properties', jsonb_build_object(
                    'batch_size', jsonb_build_object('type', 'integer', 'minimum', 1, 'default', 200),
                    'limit', jsonb_build_object('type', 'integer', 'minimum', 1),
                    'offset', jsonb_build_object('type', 'integer', 'minimum', 0, 'default', 0),
                    'replace', jsonb_build_object('type', 'boolean', 'default', false),
                    'person_id', jsonb_build_object('type', 'integer', 'minimum', 1),
                    'keyword_id', jsonb_build_object('type', 'integer', 'minimum', 1),
                    'min_references', jsonb_build_object('type', 'integer', 'minimum', 1, 'default', 3),
                    'threshold', jsonb_build_object('type', 'number', 'minimum', 0, 'maximum', 1)
                  ),
                  'additionalProperties', false
                ),
                10800,
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
            VALUES
              (
                'recompute-face-detections',
                'Refresh detected face encodings for tenant images',
                '{"type":"object","properties":{"batch_size":{"type":"integer","minimum":1,"default":25},"limit":{"type":"integer","minimum":1},"offset":{"type":"integer","minimum":0,"default":0},"replace":{"type":"boolean","default":false}},"additionalProperties":false}',
                10800,
                2,
                1
              ),
              (
                'recompute-face-recognition-tags',
                'Recompute face-recognition machine tag suggestions from person references',
                '{"type":"object","properties":{"batch_size":{"type":"integer","minimum":1,"default":200},"limit":{"type":"integer","minimum":1},"offset":{"type":"integer","minimum":0,"default":0},"replace":{"type":"boolean","default":false},"person_id":{"type":"integer","minimum":1},"keyword_id":{"type":"integer","minimum":1},"min_references":{"type":"integer","minimum":1,"default":3},"threshold":{"type":"number","minimum":0,"maximum":1}},"additionalProperties":false}',
                10800,
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
        op.execute(
            """
            UPDATE job_definitions
            SET is_active = false,
                updated_at = now()
            WHERE key IN ('recompute-face-detections', 'recompute-face-recognition-tags')
            """
        )
    else:
        op.execute(
            """
            UPDATE job_definitions
            SET is_active = 0
            WHERE key IN ('recompute-face-detections', 'recompute-face-recognition-tags')
            """
        )
