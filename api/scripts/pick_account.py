"""Find Era accounts for the demo: enough open tickets that a wrong answer is visibly wrong,
some solved tickets so the planted bug has something to find, and an open opportunity.

    cd api && .venv/bin/python scripts/pick_account.py

Read-only. Prints candidates; put your pick in DEMO_ACCOUNT_ID in .env.
"""

import asyncio
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.workflows.renewal_brief.tools import OPEN_STATUSES, EraTools  # noqa: E402


async def main() -> None:
    era = EraTools()
    orgs = await era.get_all(era.zendesk, "/api/v2/organizations.json?per_page=100", "organizations")
    external_id = {o["id"]: o["external_id"] for o in orgs}
    tickets = await era.get_all(era.zendesk, "/api/v2/tickets.json?per_page=100", "tickets")
    opps = await era.soql("SELECT AccountId, Amount FROM Opportunity WHERE IsClosed = false")

    open_tickets, solved = Counter(), Counter()
    for t in tickets:
        acct = external_id.get(t["organization_id"])
        if t["status"] in OPEN_STATUSES:
            open_tickets[acct] += 1
        elif t["status"] == "solved":
            solved[acct] += 1
    open_opps = Counter(o["AccountId"] for o in opps)

    candidates = [
        a for a in open_tickets
        if open_tickets[a] >= 3 and solved[a] >= 1 and open_opps[a] >= 1
    ]
    candidates.sort(key=lambda a: open_tickets[a])  # small enough to keep prompts short
    print(f"{len(candidates)} candidates (open tickets, solved tickets, open opps):")
    for a in candidates[:8]:
        print(f"  {a:>10}  open={open_tickets[a]:>3}  solved={solved[a]:>2}  opps={open_opps[a]}")


if __name__ == "__main__":
    asyncio.run(main())
