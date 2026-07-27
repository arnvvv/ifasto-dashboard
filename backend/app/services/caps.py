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


# Guest-facing fast pass only displays once the queue is worth skipping.
# Below this, the offer reports queue_too_short and the card hides itself;
# it reappears automatically the moment the line reaches the threshold.
# (Staff can always sell a pass manually from the board regardless.)
MIN_FASTPASS_QUEUE = 5
