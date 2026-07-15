"""Join-time p10/p90 wait band on queue entries (B-6).

Revision ID: c7d2e9f45b18
Revises: b3e9f1c84a26
"""

from alembic import op
import sqlalchemy as sa

revision = "c7d2e9f45b18"
down_revision = "b3e9f1c84a26"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("queue_entries", sa.Column("predicted_wait_p10_at_join", sa.Float(), nullable=True))
    op.add_column("queue_entries", sa.Column("predicted_wait_p90_at_join", sa.Float(), nullable=True))


def downgrade() -> None:
    op.drop_column("queue_entries", "predicted_wait_p90_at_join")
    op.drop_column("queue_entries", "predicted_wait_p10_at_join")
