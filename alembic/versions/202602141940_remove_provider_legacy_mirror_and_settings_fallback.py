"""remove_provider_legacy_mirror_and_settings_fallback

Revision ID: 202602141940
Revises: 202602141730
Create Date: 2026-02-14 19:40:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "202602141940"
down_revision: Union[str, None] = "202602141730"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE tenants
        SET settings = CASE
            WHEN settings IS NULL THEN NULL
            ELSE (
                (
                    settings::jsonb
                    - 'sync_source_provider'
                    - 'dropbox_sync_folders'
                    - 'gdrive_sync_folders'
                    - 'dropbox_oauth_mode'
                    - 'gdrive_client_id'
                    - 'gdrive_client_secret'
                    - 'gdrive_token_secret'
                    - 'dropbox_token_secret'
                    - 'dropbox_app_secret'
                    - 'dropbox_app_key'
                )::json
            )
        END
        """
    )

    op.drop_column("tenant_provider_integrations", "legacy_mirror_json")


def downgrade() -> None:
    op.add_column(
        "tenant_provider_integrations",
        sa.Column(
            "legacy_mirror_json",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
    )
