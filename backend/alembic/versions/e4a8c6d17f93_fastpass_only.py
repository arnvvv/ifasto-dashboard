"""fastpass_only mode + manual line-length count.

Revision ID: e4a8c6d17f93
Revises: d1f7b3c95e28
"""

from alembic import op
import sqlalchemy as sa

revision = "e4a8c6d17f93"
down_revision = "d1f7b3c95e28"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("venue_settings", sa.Column("fastpass_only", sa.Boolean(), nullable=False, server_default=sa.true()))
    op.add_column("venue_settings", sa.Column("manual_queue_count", sa.Integer(), nullable=False, server_default="0"))


def downgrade() -> None:
    op.drop_column("venue_settings", "manual_queue_count")
    op.drop_column("venue_settings", "fastpass_only")
