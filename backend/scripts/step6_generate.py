"""Step 6 check: the generation graph end to end with the verifier, against the real corpus.

Usage: python scripts/step6_generate.py ["topic" kind] ...   (defaults below)
"""

import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from core.generation_graph import generate
from core.retrieval import get_output

CASES = [
    ("Grimmer Greenway Trail Extension Project grant funds", "summary"),
    ("Grimmer Greenway Trail Extension Project grant funds", "proscons"),
    ("Fremont property tax rate for 2027", "summary"),  # not in the corpus: must end as insufficient_evidence
]


async def main() -> None:
    args = sys.argv[1:]
    cases = [(args[i], args[i + 1]) for i in range(0, len(args) - 1, 2)] if args else CASES
    for topic, kind in cases:
        result = await generate(topic, kind)
        print(f"\n=== {kind}: {topic!r}")
        print(
            f"status={result['status']} relevant={result['relevant_chunks']} "
            f"retrieved={result['retrieved_chunks']} order={result['execution_order']}"
        )
        if result["output_id"]:
            output = get_output(result["output_id"])
            print(json.dumps(output["body"], indent=1, ensure_ascii=False)[:3000])
            verified = all(claim["verified"] for claim in output["claims"])
            print(f"stored claims: {len(output['claims'])}, all verified={verified}")
        for stripped in result["stripped_claims"]:
            print("stripped:", json.dumps(stripped, ensure_ascii=False)[:300])


if __name__ == "__main__":
    asyncio.run(main())
