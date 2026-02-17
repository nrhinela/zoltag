"""seed_rbac_defaults_and_backfill

Revision ID: 202602171930
Revises: 202602171900
Create Date: 2026-02-17 19:30:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "202602171930"
down_revision: Union[str, None] = "202602171900"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


PERMISSIONS: tuple[tuple[str, str, str], ...] = (
    ("image.view", "View images and image metadata", "images"),
    ("image.rate", "Set image ratings", "images"),
    ("image.tag", "Apply or remove tags", "images"),
    ("image.note.edit", "Edit image/asset notes", "images"),
    ("image.variant.manage", "Upload and manage image variants", "images"),
    ("search.use", "Use search views and filters", "search"),
    ("curate.use", "Use curate workflows", "curate"),
    ("list.view", "View lists", "lists"),
    ("list.create", "Create lists", "lists"),
    ("list.edit.own", "Edit own lists", "lists"),
    ("list.edit.shared", "Edit shared lists", "lists"),
    ("provider.view", "View provider/integration status", "integrations"),
    ("provider.manage", "Manage provider/integration configuration", "integrations"),
    ("tenant.users.view", "View tenant users and invitations", "tenant_admin"),
    ("tenant.users.manage", "Manage tenant users and invitations", "tenant_admin"),
    ("tenant.jobs.view", "View tenant job queue", "jobs"),
    ("tenant.jobs.enqueue", "Enqueue jobs and workflows", "jobs"),
    ("tenant.jobs.manage", "Manage/cancel/delete jobs and workflows", "jobs"),
    ("tenant.settings.manage", "Manage tenant-level settings", "tenant_admin"),
)


ROLE_MAPPINGS: tuple[tuple[str, str], ...] = (
    # user
    ("user", "image.view"),
    ("user", "search.use"),
    ("user", "list.view"),
    ("user", "list.create"),
    ("user", "list.edit.own"),
    # editor
    ("editor", "image.view"),
    ("editor", "image.rate"),
    ("editor", "image.tag"),
    ("editor", "image.note.edit"),
    ("editor", "image.variant.manage"),
    ("editor", "search.use"),
    ("editor", "curate.use"),
    ("editor", "list.view"),
    ("editor", "list.create"),
    ("editor", "list.edit.own"),
    ("editor", "list.edit.shared"),
    ("editor", "provider.view"),
    ("editor", "tenant.jobs.view"),
    ("editor", "tenant.jobs.enqueue"),
    # admin
    ("admin", "image.view"),
    ("admin", "image.rate"),
    ("admin", "image.tag"),
    ("admin", "image.note.edit"),
    ("admin", "image.variant.manage"),
    ("admin", "search.use"),
    ("admin", "curate.use"),
    ("admin", "list.view"),
    ("admin", "list.create"),
    ("admin", "list.edit.own"),
    ("admin", "list.edit.shared"),
    ("admin", "provider.view"),
    ("admin", "provider.manage"),
    ("admin", "tenant.users.view"),
    ("admin", "tenant.users.manage"),
    ("admin", "tenant.jobs.view"),
    ("admin", "tenant.jobs.enqueue"),
    ("admin", "tenant.jobs.manage"),
    ("admin", "tenant.settings.manage"),
)


def _values_clause(rows: tuple[tuple[str, ...], ...]) -> str:
    encoded_rows = []
    for row in rows:
        encoded = []
        for value in row:
            escaped = value.replace("'", "''")
            encoded.append(f"'{escaped}'")
        encoded_rows.append(f"({', '.join(encoded)})")
    return ",\n            ".join(encoded_rows)


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return

    permission_values = _values_clause(PERMISSIONS)
    op.execute(
        sa.text(
            f"""
            INSERT INTO permission_catalog ("key", description, category)
            VALUES
                {permission_values}
            ON CONFLICT ("key") DO UPDATE
            SET
                description = EXCLUDED.description,
                category = EXCLUDED.category,
                is_active = true,
                updated_at = now()
            """
        )
    )

    op.execute(
        sa.text(
            """
            INSERT INTO tenant_roles (
                id,
                tenant_id,
                role_key,
                label,
                description,
                is_system,
                is_active,
                created_at,
                updated_at
            )
            SELECT
                gen_random_uuid(),
                t.id,
                role_template.role_key,
                role_template.label,
                role_template.description,
                true,
                true,
                now(),
                now()
            FROM tenants t
            CROSS JOIN (
                VALUES
                    ('user', 'User', 'Default end-user access'),
                    ('editor', 'Editor', 'Can edit ratings, tags, notes, and curate content'),
                    ('admin', 'Admin', 'Full tenant administration access')
            ) AS role_template(role_key, label, description)
            ON CONFLICT (tenant_id, role_key) DO UPDATE
            SET
                label = EXCLUDED.label,
                description = EXCLUDED.description,
                is_system = true,
                is_active = true,
                updated_at = now()
            """
        )
    )

    mapping_values = _values_clause(ROLE_MAPPINGS)
    op.execute(
        sa.text(
            f"""
            INSERT INTO tenant_role_permissions (role_id, permission_key, effect, created_at)
            SELECT
                tr.id,
                mapping.permission_key,
                'allow',
                now()
            FROM tenant_roles tr
            JOIN (
                VALUES
                    {mapping_values}
            ) AS mapping(role_key, permission_key)
                ON mapping.role_key = tr.role_key
            ON CONFLICT (role_id, permission_key) DO UPDATE
            SET effect = 'allow'
            """
        )
    )

    op.execute(
        sa.text(
            """
            UPDATE user_tenants AS ut
            SET tenant_role_id = tr.id
            FROM tenant_roles AS tr
            WHERE tr.tenant_id = ut.tenant_id
              AND tr.role_key = (
                  CASE lower(trim(coalesce(ut.role, 'user')))
                      WHEN 'admin' THEN 'admin'
                      WHEN 'editor' THEN 'editor'
                      ELSE 'user'
                  END
              )
              AND (ut.tenant_role_id IS NULL OR ut.tenant_role_id <> tr.id)
            """
        )
    )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return

    op.execute(
        sa.text(
            """
            UPDATE user_tenants AS ut
            SET role = tr.role_key
            FROM tenant_roles AS tr
            WHERE ut.tenant_role_id = tr.id
              AND tr.role_key IN ('user', 'editor', 'admin')
            """
        )
    )

    op.execute(sa.text("UPDATE user_tenants SET tenant_role_id = NULL"))

    op.execute(
        sa.text(
            """
            DELETE FROM tenant_role_permissions AS trp
            USING tenant_roles AS tr
            WHERE trp.role_id = tr.id
              AND tr.is_system = true
              AND tr.role_key IN ('user', 'editor', 'admin')
            """
        )
    )

    op.execute(
        sa.text(
            """
            DELETE FROM tenant_roles
            WHERE is_system = true
              AND role_key IN ('user', 'editor', 'admin')
            """
        )
    )

    # Keep permission_catalog rows in place on downgrade to avoid accidental
    # data loss for any custom role mappings created after upgrade.
