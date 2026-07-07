"""WTP intercept-survey table.

Stated-preference rows from field interviews. Separate from queue_entries /
price_quote_logs by design: survey answers must never contaminate the
model's label source or the conversion denominator.

Revision ID: d4f6a1b83c29
Revises: c8e3f5a20d17
Create Date: 2026-07-07
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "d4f6a1b83c29"
down_revision = "c8e3f5a20d17"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "wtp_surveys",
        sa.Column("id", sa.UUID(as_uuid=True), primary_key=True),
        sa.Column("restaurant_id", sa.UUID(as_uuid=True), sa.ForeignKey("restaurants.id"), nullable=True),
        sa.Column("venue_label", sa.String(length=120), nullable=False),
        sa.Column("observed_wait_mins", sa.Integer(), nullable=True),
        sa.Column("party_size", sa.Integer(), nullable=False),
        sa.Column("respondent", sa.String(length=10), nullable=False),
        sa.Column("would_skip", sa.Boolean(), nullable=False),
        sa.Column("max_fee_yen", sa.Integer(), nullable=True),
        sa.Column("reason", sa.String(length=80), nullable=True),
        sa.Column("notes", sa.String(length=500), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_wtp_surveys_created_at", "wtp_surveys", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_wtp_surveys_created_at", table_name="wtp_surveys")
    op.drop_table("wtp_surveys")
