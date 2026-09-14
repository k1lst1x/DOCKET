"""Step 1 check: one Strands agent answering "say ok" through Claude Sonnet on Bedrock."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from strands import Agent
from strands.models import BedrockModel

from core import settings


def main() -> None:
    model = BedrockModel(model_id=settings.BEDROCK_MODEL_ID, region_name=settings.AWS_REGION)
    agent = Agent(model=model, callback_handler=None)
    result = agent("say ok")
    print(f"model={settings.BEDROCK_MODEL_ID} region={settings.AWS_REGION}")
    print(str(result).strip())


if __name__ == "__main__":
    main()
