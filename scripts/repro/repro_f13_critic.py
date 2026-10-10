"""Probe the lexical critic against contradiction and unrelated-answer cases."""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from services.rag_engine.agent.critic import CriticAgent

critic = CriticAgent()
context = "Qdrant is a vector database used to store embeddings."
cases = {
    "contradiction": "Qdrant is not a vector database used to store embeddings.",
    "bananas": "Bananas are yellow and sweet.",
}
print(json.dumps({name: critic.evaluate("What is Qdrant?", draft, context).model_dump() for name, draft in cases.items()}))
