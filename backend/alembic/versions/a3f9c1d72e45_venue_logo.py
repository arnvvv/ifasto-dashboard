"""Per-venue logo_url.

Revision ID: a3f9c1d72e45
Revises: f2a8c5d91e63
"""

from alembic import op
import sqlalchemy as sa

revision = "a3f9c1d72e45"
down_revision = "f2a8c5d91e63"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("restaurants", sa.Column("logo_url", sa.String(length=300), nullable=True))


def downgrade() -> None:
    op.drop_column("restaurants", "logo_url")
