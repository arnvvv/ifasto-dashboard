"""Contact inquiries from the marketing site.

Revision ID: a1c8e5f72d94
Revises: f9b4d6e21a37
Create Date: 2026-07-15
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "a1c8e5f72d94"
down_revision = "f9b4d6e21a37"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "contact_inquiries",
        sa.Column("id", sa.UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("venue_name", sa.String(length=160), nullable=True),
        sa.Column("area", sa.String(length=120), nullable=True),
        sa.Column("contact", sa.String(length=200), nullable=False),
        sa.Column("message", sa.String(length=2000), nullable=True),
        sa.Column("locale", sa.String(length=5), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_contact_inquiries_created_at", "contact_inquiries", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_contact_inquiries_created_at", table_name="contact_inquiries")
    op.drop_table("contact_inquiries")
