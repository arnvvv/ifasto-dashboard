"""Per-venue pricing_overrides JSONB on venue_settings.

Write target for calibration outputs (wait/pressure/tourist curves,
party multipliers, anchor fractions). NULL = engine defaults.

Revision ID: e5a7c2d94f81
Revises: d4f6a1b83c29
Create Date: 2026-07-09
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

# revision identifiers, used by Alembic.
revision = "e5a7c2d94f81"
down_revision = "d4f6a1b83c29"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("venue_settings", sa.Column("pricing_overrides", JSONB(), nullable=True))


def downgrade() -> None:
    op.drop_column("venue_settings", "pricing_overrides")
