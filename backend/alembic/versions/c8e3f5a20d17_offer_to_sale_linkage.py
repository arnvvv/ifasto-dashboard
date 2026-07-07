"""Offer-to-sale linkage on queue_entries.

pricing_session_id joins a premium entry to the quote it accepted
(price_quote_logs.session_id); quoted_price preserves the engine's quote
even when the operator overrides skip_price.

Revision ID: c8e3f5a20d17
Revises: b7d2e4a91c55
Create Date: 2026-07-07
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "c8e3f5a20d17"
down_revision = "b7d2e4a91c55"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("queue_entries", sa.Column("pricing_session_id", sa.String(length=64), nullable=True))
    op.add_column("queue_entries", sa.Column("quoted_price", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("queue_entries", "quoted_price")
    op.drop_column("queue_entries", "pricing_session_id")
