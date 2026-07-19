"""Survey v2: randomized-price WTP + patience fields.

Revision ID: f2a8c5d91e63
Revises: c7d2e9f45b18
"""

from alembic import op
import sqlalchemy as sa

revision = "f2a8c5d91e63"
down_revision = "c7d2e9f45b18"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("wtp_surveys", sa.Column("offered_price_yen", sa.Integer(), nullable=True))
    op.add_column("wtp_surveys", sa.Column("perceived_wait_mins", sa.Integer(), nullable=True))
    op.add_column("wtp_surveys", sa.Column("stated_max_wait_mins", sa.Integer(), nullable=True))
    op.add_column("wtp_surveys", sa.Column("time_pressure", sa.String(length=10), nullable=True))
    op.add_column("wtp_surveys", sa.Column("first_visit", sa.Boolean(), nullable=True))


def downgrade() -> None:
    for col in ["first_visit", "time_pressure", "stated_max_wait_mins", "perceived_wait_mins", "offered_price_yen"]:
        op.drop_column("wtp_surveys", col)
