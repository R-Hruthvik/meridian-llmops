"""Query Reformulator node rewriting queries for iterative self-healing retrieval."""

import re


class QueryReformulator:
    """Expands or rewrites query to explore alternative retrieval angles."""

    def reformulate(self, query: str, cycle: int) -> str:
        words = re.findall(r"\w+", query)
        if cycle == 1:
            # Step-back prompting: broaden the query
            return f"overview concepts: {' '.join(words[:6])}"
        elif cycle == 2:
            # Extract key entity terms
            return " ".join([w for w in words if len(w) > 3])
        else:
            return f"detailed documentation for: {query}"
