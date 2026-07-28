"""premium_pending_until: 5-min confirm-or-demote window for guest passes.

Revision ID: c9e5f2a84d61
Revises: b6c4d8e13f72
"""

from alembic import op
import sqlalchemy as sa

revision = "c9e5f2a84d61"
down_revision = "b6c4d8e13f72"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("queue_entries", sa.Column("premium_pending_until", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("queue_entries", "premium_pending_until")
