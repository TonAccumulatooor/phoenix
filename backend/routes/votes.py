from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException
from database import get_db
from models import VoteRequest, MigrationStatus

router = APIRouter(prefix="/api/votes", tags=["votes"])


@router.post("/")
async def cast_vote(req: VoteRequest):
    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT status FROM migrations WHERE id = ?", (req.migration_id,)
        )
        migration = await cursor.fetchone()
        if not migration:
            raise HTTPException(404, "Migration not found")
        if migration["status"] != MigrationStatus.VOTING.value:
            raise HTTPException(400, "Migration is not in voting phase")

        dist_cursor = await db.execute(
            "SELECT newmeme_total FROM distributions WHERE migration_id = ? AND wallet_address = ? AND status = 'distributed'",
            (req.migration_id, req.voter_wallet),
        )
        dist = await dist_cursor.fetchone()
        if not dist:
            raise HTTPException(403, "Only NEWMEME holders who received distribution can vote")

        vote_weight = dist["newmeme_total"]

        await db.execute(
            """INSERT OR REPLACE INTO votes
            (migration_id, voter_wallet, candidate_wallet, vote_weight, voted_at)
            VALUES (?, ?, ?, ?, ?)""",
            (
                req.migration_id,
                req.voter_wallet,
                req.candidate_wallet,
                vote_weight,
                datetime.now(timezone.utc).isoformat(),
            ),
        )
        await db.commit()

        return {
            "voter": req.voter_wallet,
            "candidate": req.candidate_wallet,
            "weight": vote_weight,
        }
    finally:
        await db.close()


@router.get("/{migration_id}/results")
async def get_vote_results(migration_id: str):
    db = await get_db()
    try:
        cursor = await db.execute(
            """SELECT candidate_wallet,
                      SUM(vote_weight) as total_weight,
                      COUNT(*) as vote_count
            FROM votes
            WHERE migration_id = ?
            GROUP BY candidate_wallet
            ORDER BY total_weight DESC""",
            (migration_id,),
        )
        rows = await cursor.fetchall()

        total_weight = sum(r["total_weight"] for r in rows)

        candidates = []
        for r in rows:
            pct = (r["total_weight"] / total_weight * 100) if total_weight > 0 else 0
            candidates.append({
                "candidate_wallet": r["candidate_wallet"],
                "total_weight": r["total_weight"],
                "vote_count": r["vote_count"],
                "percent": round(pct, 2),
            })

        total_voters_cursor = await db.execute(
            "SELECT COUNT(DISTINCT voter_wallet) as cnt FROM votes WHERE migration_id = ?",
            (migration_id,),
        )
        total_voters = (await total_voters_cursor.fetchone())["cnt"]

        eligible_cursor = await db.execute(
            "SELECT COUNT(*) as cnt FROM distributions WHERE migration_id = ? AND status = 'distributed'",
            (migration_id,),
        )
        eligible = (await eligible_cursor.fetchone())["cnt"]

        return {
            "migration_id": migration_id,
            "candidates": candidates,
            "total_voters": total_voters,
            "eligible_voters": eligible,
            "participation_percent": round(
                (total_voters / eligible * 100) if eligible > 0 else 0, 2
            ),
            "winner": candidates[0] if candidates else None,
        }
    finally:
        await db.close()
