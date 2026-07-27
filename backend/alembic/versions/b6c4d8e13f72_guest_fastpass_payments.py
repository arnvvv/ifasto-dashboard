"""Guest fast-pass payment fields (flagged, default register/off).

Revision ID: b6c4d8e13f72
Revises: a3f9c1d72e45
"""

from alembic import op
import sqlalchemy as sa

revision = "b6c4d8e13f72"
down_revision = "a3f9c1d72e45"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("venue_settings", sa.Column("fastpass_guest_enabled", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("venue_settings", sa.Column("payment_mode", sa.String(length=10), nullable=False, server_default="register"))
    op.add_column("venue_settings", sa.Column("stripe_secret_key", sa.String(length=200), nullable=True))
    op.add_column("queue_entries", sa.Column("stripe_checkout_id", sa.String(length=80), nullable=True))
    op.create_unique_constraint("uq_queue_entries_stripe_checkout_id", "queue_entries", ["stripe_checkout_id"])


def downgrade() -> None:
    op.drop_constraint("uq_queue_entries_stripe_checkout_id", "queue_entries", type_="unique")
    op.drop_column("queue_entries", "stripe_checkout_id")
    op.drop_column("venue_settings", "stripe_secret_key")
    op.drop_column("venue_settings", "payment_mode")
    op.drop_column("venue_settings", "fastpass_guest_enabled")
