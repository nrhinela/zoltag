"""add run_profile to job definitions and jobs

Revision ID: 202603021230
Revises: 202603021000
Create Date: 2026-03-02 12:30:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "202603021230"
down_revision: Union[str, None] = "202603021000"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_ML_KEYS = (
    "build-embeddings",
    "train-keyword-models",
    "recompute-trained-tags",
    "recompute-zeroshot-tags",
    "rebuild-asset-text-index",
    "sync-providers",
)


def upgrade() -> None:
    op.add_column(
        "job_definitions",
        sa.Column("run_profile", sa.Text(), nullable=False, server_default=sa.text("'light'")),
    )
    op.add_column(
        "jobs",
        sa.Column("run_profile", sa.Text(), nullable=False, server_default=sa.text("'light'")),
    )

    op.create_check_constraint(
        "ck_job_definitions_run_profile",
        "job_definitions",
        "run_profile in ('light','ml')",
    )
    op.create_check_constraint(
        "ck_jobs_run_profile",
        "jobs",
        "run_profile in ('light','ml')",
    )
    op.create_index(
        "idx_jobs_status_profile_schedule",
        "jobs",
        ["status", "run_profile", "scheduled_for", "priority", "queued_at"],
        unique=False,
    )

    bind = op.get_bind()
    bind.execute(
        sa.text(
            """
            UPDATE job_definitions
            SET run_profile = 'ml'
            WHERE key IN :ml_keys
            """
        ).bindparams(sa.bindparam("ml_keys", expanding=True)),
        {"ml_keys": list(_ML_KEYS)},
    )
    if bind.dialect.name == "postgresql":
        bind.execute(
            sa.text(
                """
                UPDATE jobs j
                SET run_profile = COALESCE(d.run_profile, 'light')
                FROM job_definitions d
                WHERE d.id = j.definition_id
                """
            )
        )
    else:
        bind.execute(
            sa.text(
                """
                UPDATE jobs
                SET run_profile = COALESCE(
                    (
                        SELECT d.run_profile
                        FROM job_definitions d
                        WHERE d.id = jobs.definition_id
                    ),
                    'light'
                )
                """
            )
        )

def downgrade() -> None:
    op.drop_index("idx_jobs_status_profile_schedule", table_name="jobs")
    op.drop_constraint("ck_jobs_run_profile", "jobs", type_="check")
    op.drop_constraint("ck_job_definitions_run_profile", "job_definitions", type_="check")
    op.drop_column("jobs", "run_profile")
    op.drop_column("job_definitions", "run_profile")
