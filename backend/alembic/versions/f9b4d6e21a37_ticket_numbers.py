"""Daily per-venue ticket numbers on queue entries.

Revision ID: f9b4d6e21a37
Revises: e5a7c2d94f81
Create Date: 2026-07-14
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "f9b4d6e21a37"
down_revision = "e5a7c2d94f81"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("queue_entries", sa.Column("ticket_no", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("queue_entries", "ticket_no")
