"""remove_dropbox_legacy_tenant_oauth_mode

Revision ID: 202602142020
Revises: 202602141940
Create Date: 2026-02-14 20:20:00.000000
"""

from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "202602142020"
down_revision: Union[str, None] = "202602141940"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE tenant_provider_integrations
        SET
            config_json = jsonb_set(
                COALESCE(config_json, '{}'::jsonb),
                '{oauth_mode}',
                '"managed"'::jsonb,
                true
            ),
            updated_at = NOW()
        WHERE provider_type = 'dropbox'
          AND COALESCE(config_json->>'oauth_mode', '') <> 'managed'
        """
    )


def downgrade() -> None:
    # Irreversible data normalization.
    pass

