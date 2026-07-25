"""Fairness caps shared by the pricing guardrail (advisory, at quote time)
and the queue write path (authoritative, at premium-entry creation)."""

from __future__ import annotations


def allowed_passes(queue_len: int) -> int:
    """How many fast passes may be ACTIVE (waiting, unseated) at once, by
    current queue length. Floor of 1 so the first pass is always sellable,
    then one more per 5 parties beyond a queue of 10:
        queue  0-9  -> 1      queue 15-19 -> 3
        queue 10-14 -> 2      queue 20-24 -> 4   (and so on)
    """
    if queue_len < 10:
        return 1
    return 2 + (queue_len - 10) // 5
