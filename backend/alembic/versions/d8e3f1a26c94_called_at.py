"""called_at on queue entries — the 呼び出し step.

Revision ID: d8e3f1a26c94
Revises: c7d2e9f45b18
"""

from alembic import op
import sqlalchemy as sa

revision = "d8e3f1a26c94"
down_revision = "c7d2e9f45b18"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("queue_entries", sa.Column("called_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("queue_entries", "called_at")
