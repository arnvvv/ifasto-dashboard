"""Join-time snapshot columns, walked_away_at, price_quote_logs table.

Phase A capture layer: every QueueEntry records the queue state + L1
prediction at join (training features), walk-aways get a timestamp
(right-censored labels), and every pricing quote (including refusals)
is logged for conversion analysis.

Revision ID: b7d2e4a91c55
Revises: 0ce722e617b6
Create Date: 2026-07-05
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

# revision identifiers, used by Alembic.
revision = "b7d2e4a91c55"
down_revision = "0ce722e617b6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # --- QueueEntry: outcome timestamp + join-time snapshot ---
    op.add_column("queue_entries", sa.Column("walked_away_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("queue_entries", sa.Column("queue_ahead_regular", sa.Integer(), nullable=True))
    op.add_column("queue_entries", sa.Column("queue_ahead_premium", sa.Integer(), nullable=True))
    op.add_column("queue_entries", sa.Column("queue_pressure_at_join", sa.Float(), nullable=True))
    op.add_column("queue_entries", sa.Column("predicted_wait_at_join", sa.Float(), nullable=True))
    op.add_column("queue_entries", sa.Column("prediction_request_id", sa.String(length=36), nullable=True))

    # --- Quote log ---
    op.create_table(
        "price_quote_logs",
        sa.Column("id", sa.UUID(as_uuid=True), primary_key=True),
        sa.Column("restaurant_id", sa.UUID(as_uuid=True), sa.ForeignKey("restaurants.id"), nullable=False),
        sa.Column("source", sa.String(length=20), nullable=False),
        sa.Column("party_size", sa.Integer(), nullable=False),
        sa.Column("outcome", sa.String(length=40), nullable=False),
        sa.Column("price_minor", sa.Integer(), nullable=True),
        sa.Column("currency", sa.String(length=3), nullable=True),
        sa.Column("predicted_wait_mins", sa.Float(), nullable=True),
        sa.Column("premium_share_pct", sa.Float(), nullable=True),
        sa.Column("multipliers", JSONB(), nullable=True),
        sa.Column("queue_regular", sa.Integer(), nullable=False),
        sa.Column("queue_premium", sa.Integer(), nullable=False),
        sa.Column("session_id", sa.String(length=64), nullable=True),
        sa.Column("request_id", sa.String(length=36), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_price_quote_logs_restaurant_id", "price_quote_logs", ["restaurant_id"])
    op.create_index("ix_price_quote_logs_created_at", "price_quote_logs", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_price_quote_logs_created_at", table_name="price_quote_logs")
    op.drop_index("ix_price_quote_logs_restaurant_id", table_name="price_quote_logs")
    op.drop_table("price_quote_logs")
    op.drop_column("queue_entries", "prediction_request_id")
    op.drop_column("queue_entries", "predicted_wait_at_join")
    op.drop_column("queue_entries", "queue_pressure_at_join")
    op.drop_column("queue_entries", "queue_ahead_premium")
    op.drop_column("queue_entries", "queue_ahead_regular")
    op.drop_column("queue_entries", "walked_away_at")
