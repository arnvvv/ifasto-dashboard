"""Rotatable QR tokens for guest self-serve join.

Revision ID: b3e9f1c84a26
Revises: a1c8e5f72d94
Create Date: 2026-07-15
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "b3e9f1c84a26"
down_revision = "a1c8e5f72d94"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("restaurants", sa.Column("qr_token", sa.String(length=48), nullable=True))
    op.create_unique_constraint("uq_restaurants_qr_token", "restaurants", ["qr_token"])


def downgrade() -> None:
    op.drop_constraint("uq_restaurants_qr_token", "restaurants", type_="unique")
    op.drop_column("restaurants", "qr_token")
