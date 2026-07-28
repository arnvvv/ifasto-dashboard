"""guest_free_join_enabled: QR page sells the skip; the line is the free queue.

Revision ID: d1f7b3c95e28
Revises: c9e5f2a84d61
"""

from alembic import op
import sqlalchemy as sa

revision = "d1f7b3c95e28"
down_revision = "c9e5f2a84d61"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("venue_settings", sa.Column("guest_free_join_enabled", sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade() -> None:
    op.drop_column("venue_settings", "guest_free_join_enabled")
