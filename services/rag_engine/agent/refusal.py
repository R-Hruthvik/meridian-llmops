"""Safe refusal node providing standardized responses when information is absent."""


class SafeRefusalGenerator:
    """Generates standardized refusal message when facts cannot be grounded after max cycles."""

    def generate(self, query: str) -> str:
        return (
            f"I was unable to verify factual information regarding '{query}' in the enterprise knowledge base. "
            "To prevent inaccurate responses, this query has been safely refused."
        )
