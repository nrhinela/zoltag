"""add guest identity canonicalization

Revision ID: 202602201520
Revises: 202602201430
Create Date: 2026-02-20 15:20:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "202602201520"
down_revision: Union[str, None] = "202602201430"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Replace historical uniqueness on (list_id, guest_uid) with email-canonical uniqueness.
    op.drop_constraint("uq_list_shares_list_guest", "list_shares", type_="unique")

    op.create_table(
        "guest_identities",
        sa.Column("email_normalized", sa.String(length=255), nullable=False),
        sa.Column("supabase_uid", sa.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")),
        sa.PrimaryKeyConstraint("email_normalized"),
        sa.UniqueConstraint("supabase_uid"),
    )
    op.create_index("idx_guest_identities_uid", "guest_identities", ["supabase_uid"])

    # Normalize stored guest emails.
    op.execute(
        """
        UPDATE list_shares
           SET guest_email = lower(btrim(guest_email))
         WHERE guest_email IS NOT NULL
           AND guest_email <> lower(btrim(guest_email));
        """
    )

    # Backfill one canonical UID per normalized email.
    op.execute(
        """
        INSERT INTO guest_identities (email_normalized, supabase_uid, created_at, updated_at)
        SELECT email_normalized, guest_uid, NOW(), NOW()
          FROM (
                SELECT DISTINCT ON (lower(ls.guest_email))
                       lower(ls.guest_email) AS email_normalized,
                       ls.guest_uid
                  FROM list_shares ls
                 WHERE ls.guest_email IS NOT NULL
                   AND btrim(ls.guest_email) <> ''
                 ORDER BY lower(ls.guest_email), ls.created_at ASC NULLS LAST, ls.guest_uid
               ) canonical
        ON CONFLICT (email_normalized) DO NOTHING;
        """
    )

    # Rewrite list_shares rows to canonical UID for each email.
    op.execute(
        """
        UPDATE list_shares ls
           SET guest_uid = gi.supabase_uid
          FROM guest_identities gi
         WHERE lower(ls.guest_email) = gi.email_normalized
           AND ls.guest_uid <> gi.supabase_uid;
        """
    )

    # Remove duplicate list/email rows, keeping active newest rows first.
    op.execute(
        """
        WITH ranked AS (
          SELECT id,
                 row_number() OVER (
                   PARTITION BY list_id, lower(guest_email)
                   ORDER BY (revoked_at IS NULL) DESC, created_at DESC, id DESC
                 ) AS rn
            FROM list_shares
        )
        DELETE FROM list_shares ls
         USING ranked r
         WHERE ls.id = r.id
           AND r.rn > 1;
        """
    )

    # Enforce one share row per list+email regardless of uid churn.
    op.create_index(
        "uq_list_shares_list_guest_email_norm",
        "list_shares",
        [sa.text("list_id"), sa.text("lower(guest_email)")],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("uq_list_shares_list_guest_email_norm", table_name="list_shares")
    op.drop_index("idx_guest_identities_uid", table_name="guest_identities")
    op.drop_table("guest_identities")
    op.create_unique_constraint("uq_list_shares_list_guest", "list_shares", ["list_id", "guest_uid"])
